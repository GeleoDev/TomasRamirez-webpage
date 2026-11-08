import { z } from 'zod';
import { query, one } from '../db.js';
import { parse, HttpError } from '../lib/errors.js';
import { requirePerm } from '../security/auth.js';
import { audit } from '../security/audit.js';

export default async function messageRoutes(app) {
  app.get('/api/admin/messages', { preHandler: requirePerm('messages.read') }, async (req) => {
    const { status, page } = parse(z.object({
      status: z.enum(['new', 'read', 'archived', 'all']).optional().default('all'),
      page: z.coerce.number().int().min(1).max(10_000).optional().default(1)
    }), req.query);
    const size = 30;
    const r = await query(
      `SELECT id, name, company, phone, email, left(message, 160) AS preview, source, status, created_at, count(*) OVER() AS total
         FROM contact_messages WHERE ($1 = 'all' AND status <> 'archived') OR status = $1
        ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [status, size, (page - 1) * size]
    );
    return { items: r.rows.map(({ total, ...x }) => x), total: Number(r.rows[0]?.total || 0), page, size };
  });

  app.get('/api/admin/messages/:id', { preHandler: requirePerm('messages.read') }, async (req) => {
    const id = Number(req.params.id) || 0;
    const m = await one(
      `UPDATE contact_messages SET status = CASE WHEN status = 'new' THEN 'read' ELSE status END,
              read_at = COALESCE(read_at, now()), read_by = COALESCE(read_by, $2)
        WHERE id = $1 RETURNING *`,
      [id, req.user.id]
    );
    if (!m) throw new HttpError(404, 'No existe ese mensaje.');
    return m;
  });

  app.patch('/api/admin/messages/:id', { preHandler: requirePerm('messages.manage') }, async (req) => {
    const id = Number(req.params.id) || 0;
    const { status } = parse(z.object({ status: z.enum(['new', 'read', 'archived']) }), req.body);
    const m = await one('UPDATE contact_messages SET status = $2 WHERE id = $1 RETURNING id, status', [id, status]);
    if (!m) throw new HttpError(404, 'No existe ese mensaje.');
    await audit(req, `message.${status}`, { entity: 'message', entityId: id });
    return m;
  });

  app.delete('/api/admin/messages/:id', { preHandler: requirePerm('messages.manage') }, async (req) => {
    const id = Number(req.params.id) || 0;
    const m = await one('DELETE FROM contact_messages WHERE id = $1 RETURNING id', [id]);
    if (!m) throw new HttpError(404, 'No existe ese mensaje.');
    await audit(req, 'message.delete', { entity: 'message', entityId: id });
    return { ok: true };
  });
}
