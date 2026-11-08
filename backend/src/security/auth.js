// Sesiones, carga del usuario y guardas de permisos.
import { config } from '../config.js';
import { query, one } from '../db.js';
import { randomToken, sha256, safeEqual } from './crypto.js';
import { HttpError } from '../lib/errors.js';

export const COOKIE = config.isProd ? '__Host-tr_sid' : 'tr_sid';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function cookieOptions() {
  return { path: '/', httpOnly: true, secure: config.isProd, sameSite: 'strict', maxAge: config.SESSION_MAX_HOURS * 3600 };
}

export async function createSession(reply, req, userId, { mfaPending }) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  await query(
    `INSERT INTO sessions (id, user_id, csrf_token, mfa_pending, ip, user_agent, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(hours => $7))`,
    [sha256(token), userId, csrf, mfaPending, req.ip, String(req.headers['user-agent'] || '').slice(0, 300), config.SESSION_MAX_HOURS]
  );
  reply.setCookie(COOKIE, token, cookieOptions());
  return csrf;
}

export async function destroySession(req, reply) {
  if (req.session) await query('DELETE FROM sessions WHERE id = $1', [req.session.id]);
  const { maxAge, ...opts } = cookieOptions();
  reply.clearCookie(COOKIE, opts);
}

export async function loadPermissions(userId) {
  const r = await query(
    `SELECT DISTINCT rp.permission_key AS k FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE ur.user_id = $1`,
    [userId]
  );
  return new Set(r.rows.map((x) => x.k));
}

// Hook: lee la cookie, valida la sesión (vencimiento por inactividad y absoluto) y carga usuario + permisos.
export async function attachSession(req) {
  req.session = null; req.user = null; req.perms = new Set();
  const token = req.cookies?.[COOKIE];
  if (!token || token.length > 100) return;
  const s = await one(
    `SELECT s.*, u.email, u.name, u.is_active, u.must_change_password, u.totp_enabled, u.locked_until
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()
        AND s.last_seen_at > now() - make_interval(mins => $2)
        -- El segundo paso del login tiene que completarse en 10 minutos.
        AND (NOT s.mfa_pending OR s.created_at > now() - interval '10 minutes')`,
    [sha256(token), config.SESSION_IDLE_MINUTES]
  );
  if (!s || !s.is_active) return;
  req.session = s;
  req.user = { id: s.user_id, email: s.email, name: s.name, mustChangePassword: s.must_change_password, totpEnabled: s.totp_enabled };
  if (!s.mfa_pending) req.perms = await loadPermissions(s.user_id);
  // Solo actualiza "última actividad" cada minuto para no escribir en cada pedido.
  if (Date.now() - new Date(s.last_seen_at).getTime() > 60_000) {
    await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [s.id]);
  }
}

// Bloquea pedidos que modifican datos si vienen de otro sitio.
export function checkOrigin(req) {
  if (!UNSAFE.has(req.method)) return;
  let origin = req.headers.origin;
  if (!origin && req.headers.referer) { try { origin = new URL(req.headers.referer).origin; } catch { origin = null; } }
  if (!origin || !config.allowedOrigins.has(origin.replace(/\/$/, ''))) {
    throw new HttpError(403, 'Origen no permitido.');
  }
}

/**
 * Guarda para rutas del panel.
 * opts.allowMfaPending: la ruta sirve durante el segundo paso del login.
 * opts.allowRestricted: la ruta sirve aunque falte cambiar la contraseña o configurar 2FA.
 */
export function requireAuth(opts = {}) {
  return async (req) => {
    if (!req.session) throw new HttpError(401, 'Tenés que iniciar sesión.');
    if (UNSAFE.has(req.method) && !safeEqual(req.headers['x-csrf-token'], req.session.csrf_token)) {
      throw new HttpError(403, 'Token de seguridad inválido. Recargá la página.');
    }
    if (req.session.mfa_pending && !opts.allowMfaPending) throw new HttpError(401, 'Falta el código de verificación.');
    if (!opts.allowRestricted && !req.session.mfa_pending) {
      if (req.user.mustChangePassword) throw new HttpError(403, 'Tenés que cambiar tu contraseña.', 'PASSWORD_CHANGE_REQUIRED');
      if (config.REQUIRE_2FA && !req.user.totpEnabled) throw new HttpError(403, 'Tenés que activar la verificación en dos pasos.', 'TWO_FACTOR_REQUIRED');
    }
  };
}

export function requirePerm(...keys) {
  const base = requireAuth();
  return async (req) => {
    await base(req);
    for (const k of keys) if (!req.perms.has(k)) throw new HttpError(403, 'No tenés permiso para esta acción.');
  };
}
