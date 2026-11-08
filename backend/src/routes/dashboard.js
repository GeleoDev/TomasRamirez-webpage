import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requirePerm } from '../security/auth.js';

export default async function dashboardRoutes(app) {
  // Resumen del inicio del panel: cada bloque solo aparece si el usuario tiene permiso.
  app.get('/api/admin/dashboard', { preHandler: requireAuth() }, async (req) => {
    const out = {};
    if (req.perms.has('messages.read')) {
      const r = await query(`SELECT count(*) FILTER (WHERE status = 'new')::int AS nuevos,
          count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS mes FROM contact_messages`);
      const last = await query(`SELECT id, name, company, left(message, 120) AS preview, status, created_at FROM contact_messages WHERE status <> 'archived' ORDER BY created_at DESC LIMIT 5`);
      out.messages = { ...r.rows[0], latest: last.rows };
    }
    if (req.perms.has('newsletters.read')) {
      const r = await query(`SELECT count(*) FILTER (WHERE status = 'published')::int AS publicados,
          count(*) FILTER (WHERE status = 'draft')::int AS borradores, COALESCE(sum(views), 0)::int AS lecturas FROM newsletters`);
      const top = await query(`SELECT id, title, slug, views, published_at FROM newsletters WHERE status = 'published' ORDER BY views DESC, published_at DESC LIMIT 5`);
      out.newsletters = { ...r.rows[0], top: top.rows };
    }
    if (req.perms.has('stats.read')) {
      out.umami = { dashboard: config.UMAMI_DASHBOARD_URL || null, share: config.UMAMI_SHARE_URL || null };
    }
    return out;
  });

  app.get('/api/admin/stats/newsletters', { preHandler: requirePerm('stats.read') }, async () => {
    return (await query(`SELECT id, title, slug, views, published_at FROM newsletters WHERE status = 'published' ORDER BY views DESC`)).rows;
  });
}
