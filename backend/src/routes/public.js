// Rutas públicas: API para la landing, formulario de contacto y páginas del newsletter.
import { z } from 'zod';
import { config } from '../config.js';
import { query, one } from '../db.js';
import { parse, HttpError } from '../lib/errors.js';
import { checkOrigin } from '../security/auth.js';
import { listPage, articlePage, notFoundPage } from '../views/newsletter.js';

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|curl|wget|python|headless/i;
const PUB_COLS = 'slug, title, summary, cover_path, published_at';

function pageCsp() {
  const umami = config.UMAMI_SCRIPT_URL ? new URL(config.UMAMI_SCRIPT_URL).origin : '';
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    `script-src 'self' ${umami}`.trim(),
    `connect-src 'self' ${umami}`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ');
}

function sendPage(reply, html, status = 200) {
  return reply.code(status).header('content-security-policy', pageCsp()).header('cache-control', 'public, max-age=120').type('text/html; charset=utf-8').send(html);
}

export default async function publicRoutes(app) {
  // --- API para la landing ---
  app.get('/api/public/newsletters', async (req, reply) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(50).optional().default(3) }), req.query);
    const r = await query(`SELECT ${PUB_COLS} FROM newsletters WHERE status = 'published' ORDER BY published_at DESC LIMIT $1`, [limit]);
    reply.header('cache-control', 'public, max-age=60');
    return r.rows;
  });

  app.get('/api/public/newsletters/:slug', async (req, reply) => {
    const n = await one(`SELECT ${PUB_COLS}, body_html FROM newsletters WHERE status = 'published' AND slug = $1`, [String(req.params.slug).slice(0, 100)]);
    if (!n) throw new HttpError(404, 'No existe.');
    reply.header('cache-control', 'public, max-age=60');
    return n;
  });

  // --- Formulario de contacto de la landing ---
  app.post('/api/public/contact', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    onRequest: async (req) => checkOrigin(req)
  }, async (req) => {
    const d = parse(z.object({
      nombre: z.string().trim().min(2, 'escribí tu nombre').max(120),
      inmobiliaria: z.string().trim().max(160).optional().default(''),
      telefono: z.string().trim().min(6, 'escribí un teléfono').max(40),
      email: z.string().trim().email().max(200).optional().or(z.literal('')).default(''),
      mensaje: z.string().trim().max(5000).optional().default(''),
      _honey: z.string().max(200).optional().default('')
    }), req.body);
    // Trampa para bots: si el campo oculto viene lleno, se responde OK pero no se guarda.
    if (d._honey) return { ok: true };
    await query(
      `INSERT INTO contact_messages (name, company, phone, email, message, source, ip, user_agent) VALUES ($1,$2,$3,$4,$5,'landing',$6,$7)`,
      [d.nombre, d.inmobiliaria, d.telefono, d.email, d.mensaje, req.ip, String(req.headers['user-agent'] || '').slice(0, 300)]
    );
    return { ok: true };
  });

  // --- Páginas del newsletter (HTML renderizado en el servidor, bueno para Google y para compartir) ---
  app.get('/newsletter', async (req, reply) => reply.redirect('/newsletter/', 301));
  app.get('/newsletter/', async (req, reply) => {
    const r = await query(`SELECT ${PUB_COLS} FROM newsletters WHERE status = 'published' ORDER BY published_at DESC LIMIT 100`);
    return sendPage(reply, listPage(r.rows));
  });

  app.get('/newsletter/:slug', async (req, reply) => {
    const slug = String(req.params.slug).slice(0, 100);
    const n = await one(`SELECT id, ${PUB_COLS}, body_html FROM newsletters WHERE status = 'published' AND slug = $1`, [slug]);
    if (!n) return sendPage(reply, notFoundPage(), 404);
    if (!BOT.test(String(req.headers['user-agent'] || ''))) {
      query('UPDATE newsletters SET views = views + 1 WHERE id = $1', [n.id]).catch(() => {});
    }
    const more = await query(`SELECT ${PUB_COLS} FROM newsletters WHERE status = 'published' AND id <> $1 ORDER BY published_at DESC LIMIT 3`, [n.id]);
    return sendPage(reply, articlePage(n, more.rows));
  });
}
