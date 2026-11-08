// Pruebas de la API y de las protecciones de seguridad. Usan la base definida en .env.test (se vacía al empezar).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import * as OTPAuth from 'otpauth';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool, query } from '../src/db.js';
import { hashPassword } from '../src/security/password.js';

const ORIGIN = 'http://localhost:3100';
let app;

class Client {
  constructor() { this.cookies = {}; this.csrf = null; }
  async req(method, url, body, extra = {}) {
    const headers = { origin: ORIGIN, ...(extra.headers || {}) };
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.cookie = cookie;
    if (this.csrf && method !== 'GET' && !extra.noCsrf) headers['x-csrf-token'] = this.csrf;
    const opts = { method, url, headers };
    if (extra.payload) { opts.payload = extra.payload; Object.assign(headers, extra.payloadHeaders); }
    else if (body !== undefined) opts.payload = body;
    const r = await app.inject(opts);
    for (const c of r.cookies) { if (c.value) this.cookies[c.name] = c.value; else delete this.cookies[c.name]; }
    let json = null; try { json = r.json(); } catch {}
    return { status: r.statusCode, json, headers: r.headers, body: r.body };
  }
  get(u, e) { return this.req('GET', u, undefined, e); }
  post(u, b, e) { return this.req('POST', u, b ?? {}, e); }
  put(u, b, e) { return this.req('PUT', u, b, e); }
  patch(u, b, e) { return this.req('PATCH', u, b, e); }
  del(u, e) { return this.req('DELETE', u, undefined, e); }
}

const totpFor = (secret) => new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 });

async function loginFull(c, email, pw, secret) {
  let r = await c.post('/api/auth/login', { email, password: pw });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  c.csrf = r.json.csrf;
  if (r.json.needsCode) {
    // En pruebas se borra el último código usado (en la vida real cada código sirve una sola vez).
    await query('UPDATE users SET totp_last_step = NULL WHERE lower(email) = lower($1)', [email]);
    const code = totpFor(secret).generate();
    r = await c.post('/api/auth/2fa/verify', { code });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
}

let adminSecret;
const ADMIN = { email: 'tomas@example.com', pw: 'Clave-Muy-Segura-2026' };

before(async () => {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ log: () => {} });
  const u = await query('INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id', [ADMIN.email, 'Tomas', await hashPassword(ADMIN.pw)]);
  await query(`INSERT INTO user_roles SELECT $1, id FROM roles WHERE key = 'admin'`, [u.rows[0].id]);
  app = await buildApp({ logger: false });
});
after(async () => { await app.close(); await pool.end(); });

test('login incorrecto da error genérico y no crea sesión', async () => {
  const c = new Client();
  const r = await c.post('/api/auth/login', { email: ADMIN.email, password: 'mala-clave-123456' });
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'Correo o contraseña incorrectos.');
  const r2 = await c.post('/api/auth/login', { email: 'nadie@x.com', password: 'mala-clave-123456' });
  assert.equal(r2.json.error, r.json.error);
  assert.equal(Object.keys(c.cookies).length, 0);
});

test('pedidos desde otro origen se rechazan', async () => {
  const c = new Client();
  const r = await c.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.pw }, { headers: { origin: 'https://malo.com' } });
  assert.equal(r.status, 403);
});

test('primer ingreso obliga a activar 2FA antes de usar el panel', async () => {
  const c = new Client();
  await loginFull(c, ADMIN.email, ADMIN.pw);
  const me = await c.get('/api/auth/me');
  assert.equal(me.json.user.email, ADMIN.email);
  assert.ok(me.json.perms.includes('users.manage'));
  const blocked = await c.get('/api/admin/newsletters');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'TWO_FACTOR_REQUIRED');
  // Activar 2FA
  const setup = await c.post('/api/auth/2fa/setup');
  assert.ok(setup.json.qr.startsWith('data:image/png'));
  adminSecret = setup.json.secret;
  const bad = await c.post('/api/auth/2fa/enable', { code: '000000' });
  assert.equal(bad.status, 400);
  const ok = await c.post('/api/auth/2fa/enable', { code: totpFor(adminSecret).generate() });
  assert.equal(ok.status, 200);
  const now = await c.get('/api/admin/newsletters');
  assert.equal(now.status, 200);
  const row = await query('SELECT totp_secret FROM users WHERE email = $1', [ADMIN.email]);
  assert.ok(row.rows[0].totp_secret.startsWith('v1.'), 'el secreto 2FA se guarda cifrado');
});

test('con 2FA activo, la contraseña sola no alcanza', async () => {
  const c = new Client();
  const r = await c.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.pw });
  assert.equal(r.json.needsCode, true);
  c.csrf = r.json.csrf;
  const me = await c.get('/api/auth/me');
  assert.equal(me.json.user, null);
  const blocked = await c.get('/api/admin/newsletters');
  assert.equal(blocked.status, 401);
});

test('sin token CSRF no se puede modificar nada', async () => {
  const c = new Client();
  await loginFull(c, ADMIN.email, ADMIN.pw, adminSecret);
  const r = await c.post('/api/admin/newsletters', { title: 'Hola mundo' }, { noCsrf: true });
  assert.equal(r.status, 403);
});

let nlId;
test('newsletter: crear, limpiar HTML peligroso, publicar y ver en la web', async () => {
  const c = new Client();
  await loginFull(c, ADMIN.email, ADMIN.pw, adminSecret);
  const md = '## Título\n\nTexto con **negrita**. <script>alert(1)</script> <img src="https://malo.com/x.png" onerror="alert(1)"> [link](javascript:alert(1)) [ok](https://google.com)\n\n<iframe src="https://malo.com"></iframe>';
  const r = await c.post('/api/admin/newsletters', { title: 'Cómo destacar tu inmobiliaria', summary: 'Ideas', body_md: md });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  nlId = r.json.id;
  assert.equal(r.json.slug, 'como-destacar-tu-inmobiliaria');
  const h = r.json.body_html;
  assert.ok(!/script|onerror|iframe|javascript:|malo\.com/i.test(h), h);
  assert.ok(h.includes('<strong>negrita</strong>'));
  assert.ok(h.includes('rel="noopener noreferrer nofollow"'));
  // Borrador no visible
  let page = await app.inject({ url: '/newsletter/como-destacar-tu-inmobiliaria' });
  assert.equal(page.statusCode, 404);
  const pub = await c.post(`/api/admin/newsletters/${nlId}/status`, { status: 'published' });
  assert.equal(pub.status, 200);
  page = await app.inject({ url: '/newsletter/como-destacar-tu-inmobiliaria', headers: { 'user-agent': 'Mozilla/5.0' } });
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes('Cómo destacar tu inmobiliaria'));
  assert.ok(page.headers['content-security-policy'].includes("default-src 'self'"));
  const list = await app.inject({ url: '/api/public/newsletters' });
  assert.equal(list.json().length, 1);
  await new Promise((r) => setTimeout(r, 50));
  const v = await query('SELECT views FROM newsletters WHERE id = $1', [nlId]);
  assert.equal(v.rows[0].views, 1);
});

test('títulos con HTML se escapan en la página pública', async () => {
  const c = new Client();
  await loginFull(c, ADMIN.email, ADMIN.pw, adminSecret);
  const r = await c.post('/api/admin/newsletters', { title: '<img src=x onerror=alert(1)> Prueba', body_md: 'x'.repeat(40) });
  await c.post(`/api/admin/newsletters/${r.json.id}/status`, { status: 'published' });
  const page = await app.inject({ url: `/newsletter/${r.json.slug}` });
  assert.ok(!page.body.includes('<img src=x'));
  assert.ok(page.body.includes('&lt;img src=x'));
});

test('subida de imágenes: acepta imagen real, rechaza archivos disfrazados', async () => {
  const c = new Client();
  await loginFull(c, ADMIN.email, ADMIN.pw, adminSecret);
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#0E2A20' } }).png().toBuffer();
  const form = (buf, name, type) => {
    const b = '----x' + Date.now();
    const payload = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
      buf, Buffer.from(`\r\n--${b}--\r\n`)
    ]);
    return { payload, payloadHeaders: { 'content-type': `multipart/form-data; boundary=${b}` } };
  };
  const ok = await c.req('POST', '/api/admin/media', undefined, form(png, 'foto.png', 'image/png'));
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.match(ok.json.path, /^\/uploads\/\d{4}\/\d{2}\/\w+\.webp$/);
  const fake = await c.req('POST', '/api/admin/media', undefined, form(Buffer.from('<?php system($_GET[1]); ?>'), 'x.png', 'image/png'));
  assert.equal(fake.status, 400);
  const svg = await c.req('POST', '/api/admin/media', undefined, form(Buffer.from('<svg onload=alert(1)>'), 'x.svg', 'image/svg+xml'));
  assert.equal(svg.status, 400);
});

test('formulario de contacto guarda el mensaje y respeta la trampa anti-bots', async () => {
  const send = (payload, origin = 'http://localhost:3100') => app.inject({ method: 'POST', url: '/api/public/contact', headers: { origin }, payload });
  let r = await send({ nombre: 'Ana', inmobiliaria: 'Inmo Sur', telefono: '11 5555 5555', mensaje: 'Hola' });
  assert.equal(r.statusCode, 200);
  r = await send({ nombre: 'Bot', telefono: '11 5555 5555', _honey: 'spam' });
  assert.equal(r.statusCode, 200);
  r = await send({ nombre: 'X', telefono: '1' });
  assert.equal(r.statusCode, 400);
  r = await send({ nombre: 'Ana', telefono: '11 5555 5555' }, 'https://malo.com');
  assert.equal(r.statusCode, 403);
  const n = await query('SELECT count(*)::int AS n FROM contact_messages');
  assert.equal(n.rows[0].n, 1);
});

test('roles: un editor no puede ver mensajes ni usuarios, ni escalar permisos', async () => {
  const c = new Client();
  await loginFull(c, ADMIN.email, ADMIN.pw, adminSecret);
  const r = await c.post('/api/admin/users', { email: 'editor@example.com', name: 'Editora', roles: ['editor'] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const temp = r.json.tempPassword;
  const e = new Client();
  await loginFull(e, 'editor@example.com', temp);
  const forced = await e.get('/api/admin/newsletters');
  assert.equal(forced.json.code, 'PASSWORD_CHANGE_REQUIRED');
  const weak = await e.post('/api/auth/password', { current: temp, next: 'corta' });
  assert.equal(weak.status, 400);
  const ch = await e.post('/api/auth/password', { current: temp, next: 'Nueva-Clave-Larga-2026x' });
  assert.equal(ch.status, 200);
  const s = await e.post('/api/auth/2fa/setup');
  await e.post('/api/auth/2fa/enable', { code: totpFor(s.json.secret).generate() });
  assert.equal((await e.get('/api/admin/newsletters')).status, 200);
  assert.equal((await e.get('/api/admin/messages')).status, 403);
  assert.equal((await e.get('/api/admin/users')).status, 403);
  assert.equal((await e.del(`/api/admin/newsletters/${nlId}`)).status, 403);
  const esc = await e.post('/api/admin/roles', { name: 'Hack', permissions: ['users.manage'] });
  assert.equal(esc.status, 403);
});

test('no se puede dejar el sistema sin administradores ni quitarse el rol a uno mismo', async () => {
  const c = new Client();
  await loginFull(c, ADMIN.email, ADMIN.pw, adminSecret);
  const me = await c.get('/api/auth/me');
  const r = await c.patch(`/api/admin/users/${me.json.user.id}`, { roles: ['editor'] });
  assert.equal(r.status, 400);
  const off = await c.patch(`/api/admin/users/${me.json.user.id}`, { is_active: false });
  assert.equal(off.status, 400);
});

test('bloqueo de cuenta después de varios intentos fallidos', async () => {
  const email = 'editor@example.com';
  for (let i = 0; i < 5; i++) {
    const c = new Client();
    await c.post('/api/auth/login', { email, password: 'incorrecta-' + i + '-xxxxxx' });
  }
  const c = new Client();
  const r = await c.post('/api/auth/login', { email, password: 'Nueva-Clave-Larga-2026x' });
  assert.equal(r.status, 429);
  const audit = await query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'login.lock'");
  assert.equal(audit.rows[0].n, 1);
});

test('un mismo código 2FA no se puede usar dos veces', async () => {
  const code = totpFor(adminSecret).generate();
  await query('UPDATE users SET totp_last_step = NULL WHERE email = $1', [ADMIN.email]);
  const a = new Client();
  let r = await a.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.pw }); a.csrf = r.json.csrf;
  assert.equal((await a.post('/api/auth/2fa/verify', { code })).status, 200);
  const b = new Client();
  r = await b.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.pw }); b.csrf = r.json.csrf;
  assert.equal((await b.post('/api/auth/2fa/verify', { code })).status, 401);
});

test('cerrar sesión invalida la cookie en el servidor', async () => {
  const c = new Client();
  await loginFull(c, ADMIN.email, ADMIN.pw, adminSecret);
  const saved = { ...c.cookies };
  await c.post('/api/auth/logout');
  const replay = new Client(); replay.cookies = saved;
  const me = await replay.get('/api/auth/me');
  assert.equal(me.json.user, null);
});

test('cabeceras de seguridad en el panel', async () => {
  const r = await app.inject({ url: '/admin/' });
  assert.equal(r.statusCode, 200);
  assert.ok(r.headers['content-security-policy'].includes("script-src 'self'"));
  assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});
