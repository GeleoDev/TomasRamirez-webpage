// Arma la aplicación Fastify con todas las protecciones y rutas.
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { attachSession, checkOrigin } from './security/auth.js';
import { HttpError } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import newsletterRoutes from './routes/newsletters.js';
import messageRoutes from './routes/messages.js';
import userRoutes from './routes/users.js';
import dashboardRoutes from './routes/dashboard.js';
import publicRoutes from './routes/public.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildApp(opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? (config.isProd ? { level: 'info', redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]'] } : false),
    trustProxy: config.TRUST_PROXY ? '127.0.0.1' : false,
    bodyLimit: 512 * 1024
  });

  await app.register(helmet, {
    // CSP estricta para el panel; las páginas del newsletter fijan la suya.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: config.UMAMI_SHARE_URL ? [new URL(config.UMAMI_SHARE_URL).origin] : ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 } });

  // Panel (archivos estáticos) y recursos del newsletter.
  await app.register(fastifyStatic, { root: path.join(root, 'admin'), prefix: '/admin/', decorateReply: false, index: ['index.html'] });
  await app.register(fastifyStatic, { root: path.join(root, 'public'), prefix: '/nl-assets/', decorateReply: false });
  if (!config.isProd) {
    // En producción nginx sirve /uploads directo desde la carpeta.
    await app.register(fastifyStatic, { root: path.resolve(config.UPLOAD_DIR), prefix: '/uploads/', decorateReply: false });
  }
  app.get('/admin', async (req, reply) => reply.redirect('/admin/', 301));

  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    if (req.url.startsWith('/api/admin') || req.url.startsWith('/api/auth')) {
      checkOrigin(req);
      await attachSession(req);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
    if (err.statusCode === 429) return reply.code(429).send({ error: 'Demasiados pedidos. Esperá un momento y probá de nuevo.' });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'El archivo es demasiado grande (máximo 10 MB).' });
    if (err.validation || (err.statusCode && err.statusCode < 500)) return reply.code(err.statusCode || 400).send({ error: 'Pedido inválido.' });
    req.log.error({ err }, 'Error interno');
    return reply.code(500).send({ error: 'Ocurrió un error en el servidor.' });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'No encontrado.' }));

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(dashboardRoutes);
  await app.register(newsletterRoutes);
  await app.register(messageRoutes);
  await app.register(userRoutes);
  await app.register(publicRoutes);
  return app;
}
