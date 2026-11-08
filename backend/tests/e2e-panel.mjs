// Recorrido completo del panel en un navegador real (Chromium). Uso: node tests/e2e-panel.mjs [carpeta-capturas]
import { createRequire } from 'node:module';
import * as OTPAuth from 'otpauth';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/npm-tools/node_modules/playwright'); }

const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = process.argv[2] || '.';
const EMAIL = 'tomas@example.com', PW = 'Clave-Muy-Segura-2026';
const errors = [];
const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console ' + m.text()); });
const shot = (n) => page.screenshot({ path: `${OUT}/panel-${n}.png` });
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { console.log('✗', name, e.message); errors.push(name + ': ' + e.message); await shot('error-' + name.replace(/\W+/g, '-')); } };

let secret;
await step('login', async () => {
  await page.goto(BASE + '/admin/');
  await page.fill('input[name=email]', EMAIL);
  await page.fill('input[name=password]', 'mala-clave-xxxx');
  await page.click('button[type=submit]');
  await page.waitForSelector('.err');
  await shot('01-login-error');
  await page.fill('input[name=password]', PW);
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Protegé tu cuenta');
});
await step('activar 2FA', async () => {
  await page.waitForSelector('.secret');
  await shot('02-2fa');
  secret = (await page.textContent('.secret')).trim();
  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
  await page.fill('input[name=code]', code);
  await page.click('button:has-text("Activar")');
  await page.waitForSelector('h1:has-text("Tomas")');
  await shot('03-inicio');
});
await step('crear newsletter con portada', async () => {
  await page.click('a:has-text("+ Nuevo newsletter")');
  await page.fill('input[name=title]', 'Por qué tu página es tu mejor vendedor');
  await page.fill('textarea[name=summary]', 'Cinco ideas simples para que más familias te escriban desde tu sitio.');
  await page.fill('textarea[name=body_md]', '## La primera impresión\n\nAntes de llamar, casi todo el mundo **mira tu página**. Si se ve vieja o es incómoda en el celular, se van a un portal.\n\n> En un mundo donde todos hacen lo mismo, lo distinto es lo que vale.\n\n### Tres cosas para revisar hoy\n\n- Que cargue rápido en el celular\n- Que tenga WhatsApp a mano\n- Que las fotos sean grandes\n');
  const img = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#1F5C45' } }).jpeg().toBuffer();
  await writeFile('/tmp/claude-0/-home-claude/fd949ba5-2455-5e61-8628-f9500ac7fa0d/scratchpad/build/cover.jpg', img);
  await page.setInputFiles('#cover-in', '/tmp/claude-0/-home-claude/fd949ba5-2455-5e61-8628-f9500ac7fa0d/scratchpad/build/cover.jpg');
  await page.waitForSelector('#cover img');
  await page.click('#mode button[data-m=preview]');
  await page.waitForSelector('#preview-box h2');
  await shot('04-editor-preview');
  await page.click('#mode button[data-m=write]');
  await page.click('button[type=submit]:has-text("Guardar")');
  await page.waitForURL(/#\/newsletters\/\d+/);
  await page.waitForSelector('button:has-text("Publicar")');
  await page.click('button:has-text("Publicar")');
  await page.click('.modal button:has-text("Publicar")');
  await page.waitForSelector('a:has-text("Ver en la web")');
  await shot('05-editor-publicado');
});
await step('página pública del newsletter', async () => {
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errors.push('public pageerror ' + e.message));
  await p2.goto(BASE + '/newsletter/');
  await p2.waitForSelector('.card');
  await p2.screenshot({ path: `${OUT}/panel-06-lista-publica.png`, fullPage: true });
  await p2.click('.card');
  await p2.waitForSelector('.prose h2');
  await p2.screenshot({ path: `${OUT}/panel-07-articulo.png`, fullPage: true });
  await p2.close();
});
await step('mensaje del formulario', async () => {
  const r = await page.request.post(BASE + '/api/public/contact', { headers: { origin: BASE }, data: { nombre: 'Laura Gómez', inmobiliaria: 'Gómez Propiedades', telefono: '11 4444 5555', mensaje: 'Hola Tomás, quiero renovar la página de la inmobiliaria. ¿Cuándo podemos hablar?' } });
  if (!r.ok()) throw new Error('contacto ' + r.status());
  await page.goto(BASE + '/admin/#/mensajes');
  await page.waitForSelector('.msg.unread');
  await page.click('.msg');
  await page.waitForSelector('text=Responder por WhatsApp');
  await shot('08-mensajes');
});
await step('usuarios y roles', async () => {
  await page.goto(BASE + '/admin/#/usuarios');
  await page.click('#new');
  await page.fill('.modal input[name=name]', 'Colaborador Redes');
  await page.fill('.modal input[name=email]', 'redes@example.com');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.modal .secret');
  await shot('09-usuario-creado');
  await page.click('.modal button:has-text("Listo")');
  await page.goto(BASE + '/admin/#/roles');
  await page.click('[data-edit]:has-text("Editar")');
  await page.waitForSelector('.modal .perm-grp');
  await shot('10-roles');
  await page.click('.modal button:has-text("Cancelar")');
});
await step('estadísticas, actividad y cuenta', async () => {
  await page.goto(BASE + '/admin/#/estadisticas'); await page.waitForSelector('meter'); await shot('11-estadisticas');
  await page.goto(BASE + '/admin/#/actividad'); await page.waitForSelector('.tbl td'); await shot('12-actividad');
  await page.goto(BASE + '/admin/#/cuenta'); await page.waitForSelector('text=Sesiones abiertas'); await shot('13-cuenta');
  await page.goto(BASE + '/admin/#/inicio'); await page.waitForSelector('.stat'); await shot('14-inicio-con-datos');
});
await step('celular', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/admin/#/inicio'); await page.waitForSelector('.stat'); await shot('15-movil');
  await page.click('#menu'); await page.waitForTimeout(300); await shot('16-movil-menu');
});
await step('cerrar sesión', async () => {
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.goto(BASE + '/admin/#/inicio');
  await page.click('#logout');
  await page.waitForSelector('input[name=email]');
});
await browser.close();
console.log(errors.length ? 'ERRORES:\n' + errors.join('\n') : 'Sin errores');
