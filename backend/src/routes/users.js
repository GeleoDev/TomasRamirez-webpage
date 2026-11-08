// Usuarios, roles y permisos.
import { z } from 'zod';
import crypto from 'node:crypto';
import { query, one, tx } from '../db.js';
import { parse, HttpError } from '../lib/errors.js';
import { hashPassword } from '../security/password.js';
import { requirePerm } from '../security/auth.js';
import { audit } from '../security/audit.js';

// Contraseña temporal legible (el usuario la cambia en el primer ingreso).
function tempPassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 16; i++) out += abc[crypto.randomInt(abc.length)];
  return out.replace(/(.{4})(?!$)/g, '$1-');
}

async function adminCount(client, exceptUserId = 0) {
  const r = await client.query(
    `SELECT count(DISTINCT u.id)::int AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
      WHERE r.key = 'admin' AND u.is_active AND u.id <> $1`, [exceptUserId]);
  return r.rows[0].n;
}

async function setRoles(client, userId, roleKeys) {
  const roles = await client.query('SELECT id, key FROM roles WHERE key = ANY($1)', [roleKeys]);
  if (roles.rowCount !== roleKeys.length) throw new HttpError(400, 'Hay un rol que no existe.');
  await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  for (const r of roles.rows) await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [userId, r.id]);
}

// Nadie puede dar permisos que no tiene (evita escalar privilegios con roles personalizados).
async function assertCanGrant(c, roleKeys, myPerms) {
  const r = await c.query('SELECT DISTINCT rp.permission_key AS k FROM roles r JOIN role_permissions rp ON rp.role_id = r.id WHERE r.key = ANY($1)', [roleKeys]);
  const missing = r.rows.map((x) => x.k).filter((k) => !myPerms.has(k));
  if (missing.length) throw new HttpError(403, 'No podés asignar un rol con permisos que vos no tenés.');
}

const USER_COLS = `u.id, u.email, u.name, u.is_active, u.must_change_password, u.totp_enabled, u.locked_until, u.last_login_at, u.created_at,
  COALESCE(json_agg(json_build_object('key', r.key, 'name', r.name)) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles`;

export default async function userRoutes(app) {
  app.get('/api/admin/users', { preHandler: requirePerm('users.read') }, async () => {
    const r = await query(`SELECT ${USER_COLS} FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id GROUP BY u.id ORDER BY u.created_at`);
    return r.rows;
  });

  app.post('/api/admin/users', { preHandler: requirePerm('users.manage') }, async (req) => {
    const d = parse(z.object({
      email: z.string().trim().email().max(200),
      name: z.string().trim().min(2).max(120),
      roles: z.array(z.string().max(60)).min(1, 'elegí al menos un rol').max(10)
    }), req.body);
    const pw = tempPassword();
    const user = await tx(async (c) => {
      await assertCanGrant(c, d.roles, req.perms);
      const exists = await c.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [d.email]);
      if (exists.rowCount) throw new HttpError(409, 'Ya existe un usuario con ese correo.');
      const u = (await c.query(
        'INSERT INTO users (email, name, password_hash, must_change_password) VALUES ($1,$2,$3,TRUE) RETURNING id, email, name',
        [d.email, d.name, await hashPassword(pw)])).rows[0];
      await setRoles(c, u.id, d.roles);
      return u;
    });
    await audit(req, 'user.create', { entity: 'user', entityId: user.id, details: { email: user.email, roles: d.roles } });
    return { user, tempPassword: pw };
  });

  app.patch('/api/admin/users/:id', { preHandler: requirePerm('users.manage') }, async (req) => {
    const id = Number(req.params.id) || 0;
    const d = parse(z.object({
      name: z.string().trim().min(2).max(120).optional(),
      is_active: z.boolean().optional(),
      roles: z.array(z.string().max(60)).min(1).max(10).optional()
    }), req.body);
    await tx(async (c) => {
      const u = (await c.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!u) throw new HttpError(404, 'No existe ese usuario.');
      const touchesAdmin = d.roles !== undefined || d.is_active === false;
      if (touchesAdmin && !req.perms.has('roles.manage')) {
        const isAdmin = (await c.query(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.key = 'admin'`, [id])).rowCount;
        if (isAdmin || d.roles?.includes('admin')) throw new HttpError(403, 'Solo un administrador puede cambiar a otro administrador.');
      }
      if (d.roles !== undefined) await assertCanGrant(c, d.roles, req.perms);
      if (id === req.user.id && d.roles !== undefined) throw new HttpError(400, 'No podés cambiar tus propios roles.');
      if (id === req.user.id && d.is_active === false) throw new HttpError(400, 'No podés desactivar tu propio usuario.');
      if (d.name !== undefined) await c.query('UPDATE users SET name = $2, updated_at = now() WHERE id = $1', [id, d.name]);
      if (d.is_active !== undefined) {
        await c.query('UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1', [id, d.is_active]);
        if (!d.is_active) await c.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      }
      if (d.roles !== undefined) await setRoles(c, id, d.roles);
      if (await adminCount(c) === 0) throw new HttpError(400, 'Tiene que quedar al menos un administrador activo.');
    });
    await audit(req, 'user.update', { entity: 'user', entityId: id, details: d });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/reset-password', { preHandler: requirePerm('users.manage') }, async (req) => {
    const id = Number(req.params.id) || 0;
    if (id === req.user.id) throw new HttpError(400, 'Para tu propia contraseña usá "Mi cuenta".');
    const pw = tempPassword();
    const u = await one('UPDATE users SET password_hash = $2, must_change_password = TRUE, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1 RETURNING id',
      [id, await hashPassword(pw)]);
    if (!u) throw new HttpError(404, 'No existe ese usuario.');
    await query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(req, 'user.reset_password', { entity: 'user', entityId: id });
    return { tempPassword: pw };
  });

  app.post('/api/admin/users/:id/reset-2fa', { preHandler: requirePerm('users.manage') }, async (req) => {
    const id = Number(req.params.id) || 0;
    const u = await one('UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled = FALSE, totp_last_step = NULL WHERE id = $1 RETURNING id', [id]);
    if (!u) throw new HttpError(404, 'No existe ese usuario.');
    await query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(req, 'user.reset_2fa', { entity: 'user', entityId: id });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/unlock', { preHandler: requirePerm('users.manage') }, async (req) => {
    const id = Number(req.params.id) || 0;
    await query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [id]);
    await audit(req, 'user.unlock', { entity: 'user', entityId: id });
    return { ok: true };
  });

  // --- Roles ---
  app.get('/api/admin/permissions', { preHandler: requirePerm('users.read') }, async () => {
    return (await query('SELECT key, grp, description FROM permissions ORDER BY grp, key')).rows;
  });

  app.get('/api/admin/roles', { preHandler: requirePerm('users.read') }, async () => {
    const r = await query(`SELECT r.*, COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions,
        (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS users
      FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.id`);
    return r.rows;
  });

  const roleBody = z.object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(200).optional().default(''),
    permissions: z.array(z.string().max(60)).max(100)
  });

  async function checkPerms(c, keys) {
    const r = await c.query('SELECT count(*)::int AS n FROM permissions WHERE key = ANY($1)', [keys]);
    if (r.rows[0].n !== new Set(keys).size) throw new HttpError(400, 'Hay un permiso que no existe.');
  }

  app.post('/api/admin/roles', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const d = parse(roleBody, req.body);
    const key = d.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'rol';
    const role = await tx(async (c) => {
      await checkPerms(c, d.permissions);
      if (d.permissions.some((k) => !req.perms.has(k))) throw new HttpError(403, 'No podés dar permisos que vos no tenés.');
      if ((await c.query('SELECT 1 FROM roles WHERE key = $1', [key])).rowCount) throw new HttpError(409, 'Ya existe un rol con ese nombre.');
      const r = (await c.query('INSERT INTO roles (key, name, description) VALUES ($1,$2,$3) RETURNING *', [key, d.name, d.description])).rows[0];
      for (const p of new Set(d.permissions)) await c.query('INSERT INTO role_permissions VALUES ($1,$2)', [r.id, p]);
      return r;
    });
    await audit(req, 'role.create', { entity: 'role', entityId: role.id, details: { name: role.name, permissions: d.permissions } });
    return role;
  });

  app.put('/api/admin/roles/:id', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const id = Number(req.params.id) || 0;
    const d = parse(roleBody, req.body);
    await tx(async (c) => {
      const r = (await c.query('SELECT * FROM roles WHERE id = $1', [id])).rows[0];
      if (!r) throw new HttpError(404, 'No existe ese rol.');
      await c.query('UPDATE roles SET name = $2, description = $3 WHERE id = $1', [id, d.name, d.description]);
      // El rol Administrador siempre conserva todos los permisos.
      if (r.key !== 'admin') {
        await checkPerms(c, d.permissions);
        if (d.permissions.some((k) => !req.perms.has(k))) throw new HttpError(403, 'No podés dar permisos que vos no tenés.');
        await c.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
        for (const p of new Set(d.permissions)) await c.query('INSERT INTO role_permissions VALUES ($1,$2)', [id, p]);
      }
    });
    await audit(req, 'role.update', { entity: 'role', entityId: id, details: { permissions: d.permissions } });
    return { ok: true };
  });

  app.delete('/api/admin/roles/:id', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const id = Number(req.params.id) || 0;
    const r = await one('SELECT * FROM roles WHERE id = $1', [id]);
    if (!r) throw new HttpError(404, 'No existe ese rol.');
    if (r.is_system) throw new HttpError(400, 'Ese rol no se puede borrar.');
    const used = await one('SELECT count(*)::int AS n FROM user_roles WHERE role_id = $1', [id]);
    if (used.n) throw new HttpError(400, `Hay ${used.n} usuario(s) con este rol. Cambiales el rol antes de borrarlo.`);
    await query('DELETE FROM roles WHERE id = $1', [id]);
    await audit(req, 'role.delete', { entity: 'role', entityId: id, details: { name: r.name } });
    return { ok: true };
  });

  // --- Actividad ---
  app.get('/api/admin/audit', { preHandler: requirePerm('audit.read') }, async (req) => {
    const { page } = parse(z.object({ page: z.coerce.number().int().min(1).max(10_000).optional().default(1) }), req.query);
    const r = await query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.ip, a.details, a.created_at, u.name AS user_name, u.email AS user_email
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 50 OFFSET $1`, [(page - 1) * 50]);
    return r.rows;
  });
}
