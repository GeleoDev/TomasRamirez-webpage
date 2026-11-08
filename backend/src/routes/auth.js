import { z } from 'zod';
import { config } from '../config.js';
import { query, one } from '../db.js';
import { parse, HttpError } from '../lib/errors.js';
import { hashPassword, verifyPassword, burnTime, passwordProblem } from '../security/password.js';
import { createSession, destroySession, requireAuth } from '../security/auth.js';
import { newSecret, qrFor, checkCode } from '../security/totp.js';
import { encrypt, decrypt } from '../security/crypto.js';
import { audit } from '../security/audit.js';

const loginSchema = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });
const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'el código tiene 6 números') });

const LOGIN_FAIL = 'Correo o contraseña incorrectos.';

async function useTotp(user, code) {
  if (!user.totp_secret) return false;
  const step = checkCode(decrypt(user.totp_secret), code, user.totp_last_step);
  if (!step) return false;
  await query('UPDATE users SET totp_last_step = $2 WHERE id = $1', [user.id, step]);
  return true;
}

export default async function authRoutes(app) {
  const loginLimit = { config: { rateLimit: { max: config.LOGIN_RATE_MAX, timeWindow: '15 minutes' } } };

  app.post('/api/auth/login', loginLimit, async (req, reply) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await one('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    if (!user) {
      await burnTime(password);
      await audit(req, 'login.fail', { details: { email, reason: 'no_user' }, userId: null });
      throw new HttpError(401, LOGIN_FAIL);
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await burnTime(password);
      await audit(req, 'login.locked', { userId: user.id });
      throw new HttpError(429, 'Demasiados intentos. Probá de nuevo en unos minutos.');
    }
    const ok = await verifyPassword(user.password_hash, password);
    if (!ok || !user.is_active) {
      const fails = user.failed_logins + 1;
      const lock = fails >= config.LOGIN_MAX_FAILS;
      await query(
        `UPDATE users SET failed_logins = $2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END WHERE id = $1`,
        [user.id, lock ? 0 : fails, lock, config.LOGIN_LOCK_MINUTES]
      );
      await audit(req, lock ? 'login.lock' : 'login.fail', { userId: user.id, details: { reason: ok ? 'inactive' : 'password' } });
      throw new HttpError(401, LOGIN_FAIL);
    }
    await query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
    // Una sesión vieja en el mismo navegador se descarta (evita fijación de sesión).
    if (req.session) await destroySession(req, reply);
    const mfaPending = user.totp_enabled;
    const csrf = await createSession(reply, req, user.id, { mfaPending });
    if (!mfaPending) {
      await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
      await audit(req, 'login.ok', { userId: user.id });
    }
    return { ok: true, csrf, needsCode: mfaPending };
  });

  app.post('/api/auth/2fa/verify', { ...loginLimit, preHandler: requireAuth({ allowMfaPending: true, allowRestricted: true }) }, async (req) => {
    const { code } = parse(codeSchema, req.body);
    if (!req.session.mfa_pending) return { ok: true };
    const user = await one('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!(await useTotp(user, code))) {
      const fails = user.failed_logins + 1;
      const lock = fails >= config.LOGIN_MAX_FAILS;
      await query(`UPDATE users SET failed_logins = $2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END WHERE id = $1`,
        [user.id, lock ? 0 : fails, lock, config.LOGIN_LOCK_MINUTES]);
      if (lock) await query('DELETE FROM sessions WHERE id = $1', [req.session.id]);
      await audit(req, 'login.2fa_fail', { userId: user.id });
      throw new HttpError(401, lock ? 'Demasiados intentos. Probá de nuevo en unos minutos.' : 'Código incorrecto.');
    }
    await query('UPDATE users SET failed_logins = 0, last_login_at = now() WHERE id = $1', [user.id]);
    await query('UPDATE sessions SET mfa_pending = FALSE WHERE id = $1', [req.session.id]);
    await audit(req, 'login.ok', { userId: user.id, details: { mfa: true } });
    return { ok: true };
  });

  app.post('/api/auth/logout', { preHandler: requireAuth({ allowMfaPending: true, allowRestricted: true }) }, async (req, reply) => {
    await audit(req, 'logout');
    await destroySession(req, reply);
    return { ok: true };
  });

  // Estado de la sesión. Sin sesión responde 200 con user null (el panel decide mostrar el login).
  app.get('/api/auth/me', async (req) => {
    if (!req.session) return { user: null };
    const roles = await query('SELECT r.key, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1', [req.user.id]);
    return {
      user: req.session.mfa_pending ? null : { ...req.user, roles: roles.rows },
      needsCode: req.session.mfa_pending,
      csrf: req.session.csrf_token,
      perms: [...req.perms],
      require2fa: config.REQUIRE_2FA,
      umami: { dashboard: config.UMAMI_DASHBOARD_URL || null, share: config.UMAMI_SHARE_URL || null }
    };
  });

  app.post('/api/auth/password', { preHandler: requireAuth({ allowRestricted: true }) }, async (req) => {
    const { current, next } = parse(z.object({ current: z.string().min(1).max(200), next: z.string().max(200) }), req.body);
    const user = await one('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!(await verifyPassword(user.password_hash, current))) throw new HttpError(400, 'La contraseña actual no es correcta.');
    const problem = passwordProblem(next, user.email);
    if (problem) throw new HttpError(400, problem);
    if (await verifyPassword(user.password_hash, next)) throw new HttpError(400, 'La nueva contraseña tiene que ser distinta.');
    await query('UPDATE users SET password_hash = $2, must_change_password = FALSE, password_changed_at = now(), updated_at = now() WHERE id = $1',
      [user.id, await hashPassword(next)]);
    // Cierra el resto de las sesiones de ese usuario.
    await query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [user.id, req.session.id]);
    await audit(req, 'password.change');
    return { ok: true };
  });

  // --- Verificación en dos pasos ---
  app.post('/api/auth/2fa/setup', { preHandler: requireAuth({ allowRestricted: true }) }, async (req) => {
    if (req.user.totpEnabled) throw new HttpError(400, 'La verificación en dos pasos ya está activa.');
    const secret = newSecret();
    await query('UPDATE users SET totp_pending_secret = $2 WHERE id = $1', [req.user.id, encrypt(secret)]);
    const { uri, qr } = await qrFor(secret, req.user.email);
    return { secret, uri, qr };
  });

  app.post('/api/auth/2fa/enable', { preHandler: requireAuth({ allowRestricted: true }) }, async (req) => {
    const { code } = parse(codeSchema, req.body);
    const user = await one('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user.totp_pending_secret) throw new HttpError(400, 'Primero generá el código QR.');
    const secret = decrypt(user.totp_pending_secret);
    const step = checkCode(secret, code, null);
    if (!step) throw new HttpError(400, 'Código incorrecto. Revisá la hora de tu teléfono y probá de nuevo.');
    await query('UPDATE users SET totp_secret = $2, totp_pending_secret = NULL, totp_enabled = TRUE, totp_last_step = $3, updated_at = now() WHERE id = $1',
      [user.id, encrypt(secret), step]);
    await audit(req, '2fa.enable');
    return { ok: true };
  });

  app.post('/api/auth/2fa/disable', { preHandler: requireAuth({ allowRestricted: true }) }, async (req) => {
    const { password, code } = parse(z.object({ password: z.string().min(1).max(200), code: z.string() }), req.body);
    const user = await one('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!(await verifyPassword(user.password_hash, password)) || !(await useTotp(user, code))) {
      throw new HttpError(400, 'Contraseña o código incorrectos.');
    }
    await query('UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, totp_last_step = NULL WHERE id = $1', [user.id]);
    await audit(req, '2fa.disable');
    return { ok: true };
  });

  // --- Sesiones abiertas del propio usuario ---
  app.get('/api/auth/sessions', { preHandler: requireAuth() }, async (req) => {
    const r = await query('SELECT id, ip, user_agent, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC', [req.user.id]);
    return r.rows.map((s) => ({ ...s, id: s.id.slice(0, 12), current: s.id === req.session.id }));
  });

  app.post('/api/auth/sessions/close-others', { preHandler: requireAuth() }, async (req) => {
    const r = await query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.user.id, req.session.id]);
    await audit(req, 'sessions.close_others', { details: { count: r.rowCount } });
    return { ok: true, closed: r.rowCount };
  });
}

