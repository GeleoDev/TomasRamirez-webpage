import { z } from 'zod';
import { query, one } from '../db.js';
import { parse, HttpError } from '../lib/errors.js';
import { renderMarkdown, slugify } from '../lib/content.js';
import { storeImage } from '../lib/media.js';
import { requirePerm } from '../security/auth.js';
import { audit } from '../security/audit.js';

const coverRe = /^\/uploads\/[\w/-]+\.webp$/;
const body = z.object({
  title: z.string().trim().min(3, 'mínimo 3 caracteres').max(160),
  slug: z.string().trim().max(80).optional().default(''),
  summary: z.string().trim().max(400).optional().default(''),
  body_md: z.string().max(100_000).optional().default(''),
  cover_path: z.string().regex(coverRe).nullable().optional().default(null)
});

async function uniqueSlug(base, exceptId = 0) {
  let slug = slugify(base);
  for (let i = 2; await one('SELECT 1 FROM newsletters WHERE slug = $1 AND id <> $2', [slug, exceptId]); i++) {
    slug = `${slugify(base).slice(0, 74)}-${i}`;
  }
  return slug;
}

const LIST_COLS = 'n.id, n.slug, n.title, n.summary, n.cover_path, n.status, n.published_at, n.created_at, n.updated_at, u.name AS author';

export default async function newsletterRoutes(app) {
  app.get('/api/admin/newsletters', { preHandler: requirePerm('newsletters.read') }, async (req) => {
    const { status, q } = parse(z.object({ status: z.enum(['draft', 'published', 'archived']).optional(), q: z.string().max(100).optional() }), req.query);
    const r = await query(
      `SELECT ${LIST_COLS} FROM newsletters n LEFT JOIN users u ON u.id = n.author_id
        WHERE ($1::text IS NULL OR n.status = $1) AND ($2::text IS NULL OR n.title ILIKE '%' || $2 || '%')
        ORDER BY COALESCE(n.published_at, n.updated_at) DESC LIMIT 200`,
      [status ?? null, q ?? null]
    );
    return r.rows;
  });

  app.get('/api/admin/newsletters/:id', { preHandler: requirePerm('newsletters.read') }, async (req) => {
    const n = await one('SELECT * FROM newsletters WHERE id = $1', [Number(req.params.id) || 0]);
    if (!n) throw new HttpError(404, 'No existe ese newsletter.');
    return n;
  });

  app.post('/api/admin/newsletters/preview', { preHandler: requirePerm('newsletters.write') }, async (req) => {
    const { body_md } = parse(z.object({ body_md: z.string().max(100_000) }), req.body);
    return { html: renderMarkdown(body_md) };
  });

  app.post('/api/admin/newsletters', { preHandler: requirePerm('newsletters.write') }, async (req) => {
    const d = parse(body, req.body);
    const slug = await uniqueSlug(d.slug || d.title);
    const n = await one(
      `INSERT INTO newsletters (slug, title, summary, body_md, body_html, cover_path, author_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [slug, d.title, d.summary, d.body_md, renderMarkdown(d.body_md), d.cover_path, req.user.id]
    );
    await audit(req, 'newsletter.create', { entity: 'newsletter', entityId: n.id, details: { title: n.title } });
    return n;
  });

  app.put('/api/admin/newsletters/:id', { preHandler: requirePerm('newsletters.write') }, async (req) => {
    const id = Number(req.params.id) || 0;
    const cur = await one('SELECT * FROM newsletters WHERE id = $1', [id]);
    if (!cur) throw new HttpError(404, 'No existe ese newsletter.');
    const d = parse(body, req.body);
    // Si ya está publicado, cambiar la dirección rompe los enlaces compartidos: solo se cambia si se pide explícitamente.
    const slug = d.slug && slugify(d.slug) !== cur.slug ? await uniqueSlug(d.slug, id) : cur.slug;
    const n = await one(
      `UPDATE newsletters SET slug=$2, title=$3, summary=$4, body_md=$5, body_html=$6, cover_path=$7, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, slug, d.title, d.summary, d.body_md, renderMarkdown(d.body_md), d.cover_path]
    );
    await audit(req, 'newsletter.update', { entity: 'newsletter', entityId: id });
    return n;
  });

  app.post('/api/admin/newsletters/:id/status', { preHandler: requirePerm('newsletters.publish') }, async (req) => {
    const id = Number(req.params.id) || 0;
    const { status } = parse(z.object({ status: z.enum(['draft', 'published', 'archived']) }), req.body);
    const cur = await one('SELECT * FROM newsletters WHERE id = $1', [id]);
    if (!cur) throw new HttpError(404, 'No existe ese newsletter.');
    if (status === 'published' && (!cur.title || cur.body_md.trim().length < 20)) {
      throw new HttpError(400, 'Antes de publicar, escribí el contenido (mínimo unas líneas).');
    }
    const n = await one(
      `UPDATE newsletters SET status = $2, published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, status]
    );
    await audit(req, `newsletter.${status}`, { entity: 'newsletter', entityId: id, details: { title: n.title } });
    return n;
  });

  app.delete('/api/admin/newsletters/:id', { preHandler: requirePerm('newsletters.delete') }, async (req) => {
    const id = Number(req.params.id) || 0;
    const n = await one('DELETE FROM newsletters WHERE id = $1 RETURNING id, title', [id]);
    if (!n) throw new HttpError(404, 'No existe ese newsletter.');
    await audit(req, 'newsletter.delete', { entity: 'newsletter', entityId: id, details: { title: n.title } });
    return { ok: true };
  });

  // Subida de imágenes (portadas e imágenes dentro del texto).
  app.post('/api/admin/media', { preHandler: requirePerm('media.upload'), config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'No llegó ningún archivo.');
    const buf = await file.toBuffer();
    const saved = await storeImage(buf, file.mimetype);
    const m = await one(
      'INSERT INTO media (path, original_name, mime, width, height, size_bytes, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, path, width, height',
      [saved.path, String(file.filename || '').slice(0, 200), 'image/webp', saved.width, saved.height, saved.size, req.user.id]
    );
    await audit(req, 'media.upload', { entity: 'media', entityId: m.id });
    return m;
  });
}
