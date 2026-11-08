// Panel de administración de tomasramirezdev.com — sin dependencias externas.
// Todo texto que viene del servidor se escapa con html`` antes de insertarse.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

// ---------- Plantillas seguras ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(String(s));
function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
    else out += v instanceof Raw ? v.s : esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}

// ---------- Estado y API ----------
const state = { me: null, csrf: null, perms: new Set(), umami: {}, newMessages: 0 };
const can = (p) => state.perms.has(p);

async function api(method, url, body, { form } = {}) {
  const headers = { accept: 'application/json' };
  if (state.csrf && method !== 'GET') headers['x-csrf-token'] = state.csrf;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  let data = null;
  try { data = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) {
    const err = new Error(data?.error || `Error ${r.status}`);
    err.status = r.status; err.code = data?.code;
    if (r.status === 401 && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/2fa/verify')) { await boot(); }
    if (err.code === 'PASSWORD_CHANGE_REQUIRED' || err.code === 'TWO_FACTOR_REQUIRED') { await boot(); }
    throw err;
  }
  return data;
}
const GET = (u) => api('GET', u);
const POST = (u, b) => api('POST', u, b ?? {});

// ---------- Utilidades de interfaz ----------
function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3800);
}
const fail = (e) => toast(e.message || 'Ocurrió un error', true);

function fmtDate(d, withTime = true) {
  if (!d) return '—';
  const x = new Date(d);
  return x.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }) + (withTime ? ' · ' + x.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '');
}

function modal(content, onMount) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = html`<div class="modal" role="dialog" aria-modal="true">${content}</div>`;
  document.body.append(bg);
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  $$('[data-close]', bg).forEach((b) => b.addEventListener('click', close));
  onMount?.(bg, close);
  $('input,textarea,select,button', bg)?.focus();
  return close;
}

function confirmDialog(text, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    modal(html`<h3>${text}</h3><div class="row end"><button class="btn line" data-close>Cancelar</button><button class="btn ${danger ? 'danger' : ''}" data-ok>${ok}</button></div>`,
      (root, close) => {
        $('[data-ok]', root).addEventListener('click', () => { close(); resolve(true); });
        $$('[data-close]', root).forEach((b) => b.addEventListener('click', () => resolve(false)));
      });
  });
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function withBusy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
}

const ICON = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  news: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  log: '<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
};
const svg = (name) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`);
const LOGO = raw('<svg viewBox="25 110 608 320" width="44" height="23" aria-hidden="true"><path fill="#E2C27A" d="M182.227 353.849 L39.141 280.193 L39.141 251.256 L182.227 177.601 L182.227 208.729 L114.718 242.926 L75.969 264.848 L75.969 266.601 L114.718 288.523 L182.227 322.72 Z"/><path fill="#E2C27A" d="M475.39 177.601 L618.476 251.256 L618.476 280.193 L475.39 353.849 L475.39 322.72 L542.899 288.523 L581.648 266.601 L581.648 264.848 L542.899 242.926 L475.39 208.729 Z"/><path fill="#F7F3EA" d="M159.558 151.941 L145.558 122.228 L363.024 123.228 L349.024 151.941 L273.319 151.941 L273.319 417.431 L235.263 417.431 L235.263 151.941 Z"/><path fill="#F7F3EA" d="M354.575 153.411 L368.512 124.144 C370.705 124.789 372.854 125.488 374.961 126.24 C389.756 131.526 401.35 140.285 409.743 152.517 C418.137 164.75 422.333 181.135 422.333 201.674 C422.333 224.628 416.643 243.128 405.262 257.173 C393.881 271.218 378.517 280.807 359.17 285.942 L430.442 417.515 L390.325 417.515 L322.894 290.019 L278.937 290.019 L278.937 259.212 L319.053 259.212 C340.961 259.212 357.747 254.455 369.413 244.94 C381.078 235.426 386.911 221.004 386.911 201.674 C386.911 182.041 381.078 168.299 369.413 160.446 C365.15 157.577 360.204 155.231 354.575 153.411 Z"/></svg>');

// ---------- Arranque y acceso ----------
async function boot() {
  let me;
  try { me = await GET('/api/auth/me'); } catch { me = { user: null }; }
  state.csrf = me.csrf || null;
  state.perms = new Set(me.perms || []);
  state.umami = me.umami || {};
  state.me = me.user;
  if (me.needsCode) return renderCode();
  if (!me.user) return renderLogin();
  if (me.user.mustChangePassword) return renderForcedPassword();
  if (me.require2fa && !me.user.totpEnabled) return renderForced2fa();
  renderShell();
  route();
}

function authLayout(inner) {
  app.className = '';
  app.innerHTML = html`<div class="auth">
    <aside class="auth-side"><a class="brand" href="/">${LOGO}<span>TomasRamirez<b>Dev</b></span></a>
      <div><h1>Panel de <em>administración</em></h1><p>Newsletters, mensajes del formulario y estadísticas de tu página, en un solo lugar.</p></div>
      <p class="small">Acceso protegido · verificación en dos pasos</p></aside>
    <main class="auth-main"><div class="auth-card">${inner}</div></main></div>`;
}

function renderLogin() {
  authLayout(html`<h2>Iniciar sesión</h2><p class="muted">Ingresá con tu correo y contraseña.</p>
    <form class="stack" id="f" autocomplete="on">
      <label class="f">Correo<input class="in" name="email" type="email" required autocomplete="username"></label>
      <label class="f">Contraseña<input class="in" name="password" type="password" required autocomplete="current-password"></label>
      <div id="e"></div>
      <button class="btn" type="submit">Entrar</button>
    </form>`);
  $('#f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('button', ev.target);
    await withBusy(btn, async () => {
      try {
        const r = await api('POST', '/api/auth/login', formData(ev.target));
        state.csrf = r.csrf;
        if (r.needsCode) renderCode(); else await boot();
      } catch (e) { $('#e').innerHTML = html`<div class="err">${e.message}</div>`; }
    });
  });
}

function renderCode() {
  authLayout(html`<h2>Verificación en dos pasos</h2><p class="muted">Abrí tu app de autenticación y escribí el código de 6 números.</p>
    <form class="stack" id="f">
      <input class="in code-in" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required aria-label="Código">
      <div id="e"></div>
      <button class="btn" type="submit">Verificar</button>
      <button class="btn line" type="button" id="back">Volver</button>
    </form>`);
  $('#back').addEventListener('click', async () => { try { await POST('/api/auth/logout'); } catch {} boot(); });
  $('#f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await withBusy($('button[type=submit]', ev.target), async () => {
      try { await api('POST', '/api/auth/2fa/verify', formData(ev.target)); await boot(); }
      catch (e) { $('#e').innerHTML = html`<div class="err">${e.message}</div>`; ev.target.code.value = ''; }
    });
  });
}

function passwordForm(id) {
  return html`<form class="stack" id="${id}">
    <label class="f">Contraseña actual<input class="in" name="current" type="password" required autocomplete="current-password"></label>
    <label class="f">Nueva contraseña<input class="in" name="next" type="password" required minlength="12" autocomplete="new-password"><span class="hint">Mínimo 12 caracteres, mezclando mayúsculas, minúsculas, números o símbolos. También sirve una frase larga.</span></label>
    <label class="f">Repetir nueva contraseña<input class="in" name="next2" type="password" required autocomplete="new-password"></label>
    <div data-e></div>
    <button class="btn" type="submit">Guardar contraseña</button></form>`;
}
function bindPasswordForm(form, after) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    const box = $('[data-e]', form);
    if (d.next !== d.next2) { box.innerHTML = html`<div class="err">Las contraseñas nuevas no coinciden.</div>`; return; }
    await withBusy($('button', form), async () => {
      try { await POST('/api/auth/password', { current: d.current, next: d.next }); form.reset(); box.innerHTML = ''; toast('Contraseña actualizada'); after?.(); }
      catch (e) { box.innerHTML = html`<div class="err">${e.message}</div>`; }
    });
  });
}

function renderForcedPassword() {
  authLayout(html`<h2>Elegí tu contraseña</h2><p class="muted">Es tu primer ingreso o te reiniciaron la contraseña. Elegí una nueva para continuar.</p>${passwordForm('pf')}`);
  bindPasswordForm($('#pf'), boot);
}

async function twoFactorSetup(container, done) {
  container.innerHTML = html`<div class="spinner"></div>`;
  try {
    const s = await POST('/api/auth/2fa/setup');
    container.innerHTML = html`<div class="stack">
      <ol class="small muted"><li>Instalá <b>Google Authenticator</b>, <b>Microsoft Authenticator</b> o <b>Authy</b> en tu celular.</li><li>Escaneá este código QR con la app.</li><li>Escribí el código de 6 números que te muestra.</li></ol>
      <div class="qr"><img src="${s.qr}" alt="Código QR para la app de autenticación"><div class="stack"><span class="small muted">¿No podés escanear? Cargá esta clave a mano:</span><span class="secret">${s.secret}</span></div></div>
      <form class="stack" data-f><input class="in code-in" name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required aria-label="Código"><div data-e></div><button class="btn" type="submit">Activar</button></form></div>`;
    const f = $('[data-f]', container);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await withBusy($('button', f), async () => {
        try { await POST('/api/auth/2fa/enable', formData(f)); toast('Verificación en dos pasos activada'); done(); }
        catch (e) { $('[data-e]', f).innerHTML = html`<div class="err">${e.message}</div>`; }
      });
    });
  } catch (e) { container.innerHTML = html`<div class="err">${e.message}</div>`; }
}

function renderForced2fa() {
  authLayout(html`<h2>Protegé tu cuenta</h2><p class="muted">Para entrar al panel hace falta la verificación en dos pasos. Así, aunque alguien sepa tu contraseña, no puede ingresar sin tu celular.</p><div id="tf" class="stack"></div>
    <button class="btn line" id="out">Cerrar sesión</button>`);
  $('#out').addEventListener('click', logout);
  twoFactorSetup($('#tf'), boot);
}

async function logout() {
  try { await POST('/api/auth/logout'); } catch {}
  state.me = null; state.csrf = null;
  boot();
}

// ---------- Estructura y navegación ----------
const SECTIONS = [
  { id: 'inicio', label: 'Inicio', icon: 'home', show: () => true },
  { id: 'newsletters', label: 'Newsletters', icon: 'news', show: () => can('newsletters.read') },
  { id: 'mensajes', label: 'Mensajes', icon: 'mail', show: () => can('messages.read') },
  { id: 'estadisticas', label: 'Estadísticas', icon: 'chart', show: () => can('stats.read') },
  { id: 'usuarios', label: 'Usuarios', icon: 'users', show: () => can('users.read') },
  { id: 'roles', label: 'Roles y permisos', icon: 'key', show: () => can('users.read') },
  { id: 'actividad', label: 'Actividad', icon: 'log', show: () => can('audit.read') },
  { id: 'cuenta', label: 'Mi cuenta', icon: 'me', show: () => true }
];

function renderShell() {
  app.className = '';
  app.innerHTML = html`<div class="topbar"><a class="brand" href="#/inicio">${LOGO}</a><button id="menu" aria-label="Menú">☰</button></div>
  <div class="shell">
    <aside class="side" id="side">
      <a class="brand" href="#/inicio">${LOGO}<span>TomasRamirez<b>Dev</b></span></a>
      <nav class="nav">${SECTIONS.filter((s) => s.show()).map((s) => html`<a href="#/${s.id}" data-sec="${s.id}">${svg(s.icon)}${s.label}${s.id === 'mensajes' ? html`<span class="badge hidden" id="badge"></span>` : ''}</a>`)}</nav>
      <div class="side-foot"><b>${state.me.name}</b><span class="muted">${state.me.email}</span><br><a href="/" target="_blank" rel="noopener">Ver la página ↗</a><br><button id="logout">Cerrar sesión</button></div>
    </aside>
    <main class="main" id="view"></main>
  </div>`;
  $('#logout').addEventListener('click', logout);
  $('#menu').addEventListener('click', () => $('#side').classList.toggle('open'));
  $('#side').addEventListener('click', (e) => { if (e.target.closest('a')) $('#side').classList.remove('open'); });
  refreshBadge();
}

async function refreshBadge() {
  if (!can('messages.read')) return;
  try {
    const d = await GET('/api/admin/dashboard');
    const n = d.messages?.nuevos || 0;
    const b = $('#badge');
    if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
  } catch {}
}

const VIEWS = {};
function route() {
  if (!state.me) return;
  const [sec, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const s = SECTIONS.find((x) => x.id === sec && x.show()) ? sec : 'inicio';
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.sec === s));
  const view = $('#view');
  view.innerHTML = html`<div class="spinner"></div>`;
  Promise.resolve(VIEWS[s](view, rest)).catch((e) => { view.innerHTML = html`<div class="err">${e.message}</div>`; });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- Inicio ----------
VIEWS.inicio = async (v) => {
  const d = await GET('/api/admin/dashboard');
  const hour = new Date().getHours();
  const hi = hour < 12 ? 'Buen día' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  v.innerHTML = html`<div class="head"><div><div class="kick">Inicio</div><h1>${hi}, ${state.me.name.split(' ')[0]}.</h1></div>
    ${can('newsletters.write') ? html`<a class="btn gold" href="#/newsletters/nuevo">+ Nuevo newsletter</a>` : ''}</div>
    <div class="cards">
      ${d.messages ? html`<a class="card stat" href="#/mensajes"><b>${d.messages.nuevos}</b><span>Mensajes sin leer</span></a><div class="card stat"><b>${d.messages.mes}</b><span>Mensajes en 30 días</span></div>` : ''}
      ${d.newsletters ? html`<a class="card stat" href="#/newsletters"><b>${d.newsletters.publicados}</b><span>Newsletters publicados</span></a><div class="card stat"><b>${d.newsletters.lecturas}</b><span>Lecturas de newsletters</span></div>` : ''}
    </div>
    <div class="two">
      ${d.messages ? html`<div class="card"><div class="row between"><h3>Últimos mensajes</h3></div>
        ${d.messages.latest.length ? d.messages.latest.map((m) => html`<a class="list-item" href="#/mensajes/${m.id}"><b>${m.name}${m.company ? ' · ' + m.company : ''} ${m.status === 'new' ? html`<span class="tag new">Nuevo</span>` : ''}</b><span class="muted small">${fmtDate(m.created_at)}</span><div class="small">${m.preview || '(sin mensaje)'}</div></a>`) : html`<p class="muted">Todavía no llegaron mensajes.</p>`}</div>` : ''}
      ${d.newsletters ? html`<div class="card"><h3>Newsletters más leídos</h3>
        ${d.newsletters.top.length ? d.newsletters.top.map((n) => html`<a class="list-item" href="#/newsletters/${n.id}"><b>${n.title}</b><span class="muted small">${n.views} lecturas · ${fmtDate(n.published_at, false)}</span></a>`) : html`<p class="muted">Cuando publiques newsletters, acá vas a ver cuáles se leen más.</p>`}</div>` : ''}
    </div>
    ${d.umami?.dashboard ? html`<div class="card row between"><div><h3>Visitas de la página</h3><p class="muted">Las estadísticas completas (visitas, países, dispositivos y páginas más vistas) están en Umami.</p></div><a class="btn line" href="#/estadisticas">Ver estadísticas</a></div>` : ''}`;
};

// ---------- Newsletters ----------
const STATUS = { draft: 'Borrador', published: 'Publicado', archived: 'Archivado' };

VIEWS.newsletters = async (v, [id]) => {
  if (id) return newsletterEditor(v, id === 'nuevo' ? null : Number(id));
  let filter = '';
  async function load() {
    const list = await GET('/api/admin/newsletters' + (filter ? `?status=${filter}` : ''));
    $('#nl-list', v).innerHTML = list.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Título</th><th>Estado</th><th>Publicado</th><th>Actualizado</th></tr></thead><tbody>
      ${list.map((n) => html`<tr class="click" data-id="${n.id}"><td><b>${n.title}</b><div class="muted small">/newsletter/${n.slug}</div></td><td><span class="tag ${n.status}">${STATUS[n.status]}</span></td><td>${fmtDate(n.published_at, false)}</td><td>${fmtDate(n.updated_at)}</td></tr>`)}
      </tbody></table></div>` : html`<div class="card empty">No hay newsletters ${filter ? 'con ese estado' : 'todavía'}.</div>`;
    $$('tr[data-id]', v).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/newsletters/${tr.dataset.id}`; }));
  }
  v.innerHTML = html`<div class="head"><div><div class="kick">Contenido</div><h1>Newsletters</h1></div>${can('newsletters.write') ? html`<a class="btn gold" href="#/newsletters/nuevo">+ Nuevo newsletter</a>` : ''}</div>
    <div class="tabs" id="tabs"><button class="on" data-s="">Todos</button><button data-s="published">Publicados</button><button data-s="draft">Borradores</button><button data-s="archived">Archivados</button></div>
    <div id="nl-list"><div class="spinner"></div></div>`;
  $$('#tabs button', v).forEach((b) => b.addEventListener('click', () => { $$('#tabs button', v).forEach((x) => x.classList.toggle('on', x === b)); filter = b.dataset.s; load().catch(fail); }));
  await load();
};

async function uploadImage(file) {
  const fd = new FormData();
  fd.append('file', file);
  return api('POST', '/api/admin/media', undefined, { form: fd });
}

async function newsletterEditor(v, id) {
  const n = id ? await GET(`/api/admin/newsletters/${id}`) : { title: '', slug: '', summary: '', body_md: '', cover_path: null, status: 'draft' };
  const editable = can('newsletters.write');
  let cover = n.cover_path;
  let dirty = false;
  v.innerHTML = html`<div class="head"><div><div class="kick"><a href="#/newsletters">← Newsletters</a></div><h1>${id ? 'Editar newsletter' : 'Nuevo newsletter'}</h1></div>
    <div class="row">${id ? html`<span class="tag ${n.status}" id="st">${STATUS[n.status]}</span>` : ''}${n.status === 'published' ? html`<a class="btn line sm" href="/newsletter/${n.slug}" target="_blank" rel="noopener">Ver en la web ↗</a>` : ''}</div></div>
    <form class="editor" id="ed">
      <div class="stack">
        <label class="f">Título<input class="in" name="title" required maxlength="160" value="${n.title}" ${editable ? '' : 'disabled'}></label>
        <label class="f">Resumen <span class="hint">Aparece en la lista y al compartir el link (hasta 400 caracteres).</span><textarea class="in" name="summary" maxlength="400" rows="3" ${editable ? '' : 'disabled'}>${n.summary}</textarea></label>
        <div class="f"><div class="row between"><span class="f">Contenido</span><div class="tabs" id="mode"><button type="button" class="on" data-m="write">Escribir</button><button type="button" data-m="preview">Vista previa</button></div></div>
          <div id="write-box">
            <div class="toolbar" role="toolbar" aria-label="Formato">
              <button type="button" data-md="h2" title="Título">T</button><button type="button" data-md="h3" title="Subtítulo">t</button><span class="sep"></span>
              <button type="button" data-md="b" title="Negrita"><b>B</b></button><button type="button" data-md="i" title="Cursiva"><i>I</i></button><button type="button" data-md="link" title="Enlace">🔗</button><span class="sep"></span>
              <button type="button" data-md="ul" title="Lista">• Lista</button><button type="button" data-md="ol" title="Lista numerada">1. Lista</button><button type="button" data-md="quote" title="Cita">“ Cita</button><span class="sep"></span>
              <button type="button" data-md="img" title="Insertar imagen">🖼 Imagen</button>
            </div>
            <textarea class="in body-in" name="body_md" spellcheck="true" ${editable ? '' : 'disabled'}>${n.body_md}</textarea>
            <span class="hint">Se escribe en formato Markdown: **negrita**, *cursiva*, ## Título. Usá los botones si preferís.</span>
          </div>
          <div id="preview-box" class="preview hidden"></div>
        </div>
      </div>
      <aside class="side-card">
        <div class="card stack">
          <span class="f">Imagen de portada</span>
          <div class="cover" id="cover">${cover ? html`<img src="${cover}" alt="">` : 'Sin portada'}</div>
          ${editable ? html`<div class="row"><label class="btn line sm">Elegir imagen<input type="file" accept="image/*" id="cover-in" class="hidden"></label>${raw('<button type="button" class="btn danger sm" id="cover-rm">Quitar</button>')}</div>` : ''}
          <label class="f">Dirección <span class="hint">tomasramirezdev.com/newsletter/…</span><input class="in" name="slug" maxlength="80" value="${n.slug}" placeholder="se genera del título" ${editable ? '' : 'disabled'}></label>
        </div>
        <div class="card stack">
          ${editable ? html`<button class="btn" type="submit">Guardar</button>` : ''}
          ${id && can('newsletters.publish') ? html`${n.status !== 'published' ? html`<button class="btn gold" type="button" data-status="published">Publicar</button>` : html`<button class="btn line" type="button" data-status="draft">Pasar a borrador</button>`}
            ${n.status !== 'archived' ? html`<button class="btn line" type="button" data-status="archived">Archivar</button>` : ''}` : ''}
          ${id && can('newsletters.delete') ? html`<button class="btn danger" type="button" id="del">Eliminar</button>` : ''}
          ${id ? html`<span class="hint">Creado ${fmtDate(n.created_at)}<br>Última edición ${fmtDate(n.updated_at)}${n.published_at ? html`<br>Publicado ${fmtDate(n.published_at)}` : ''}${n.views !== undefined ? html`<br>${n.views} lecturas` : ''}</span>` : html`<span class="hint">Se guarda como borrador. Después lo podés publicar.</span>`}
        </div>
      </aside>
    </form>`;

  const form = $('#ed', v);
  const ta = form.body_md;
  form.addEventListener('input', () => { dirty = true; });
  window.onbeforeunload = () => (dirty ? true : undefined);
  window.addEventListener('hashchange', () => { window.onbeforeunload = null; }, { once: true });

  // Barra de formato
  function wrap(before, after = before, placeholder = 'texto') {
    const [s, e] = [ta.selectionStart, ta.selectionEnd];
    const sel = ta.value.slice(s, e) || placeholder;
    ta.setRangeText(before + sel + after, s, e, 'end');
    ta.focus(); dirty = true;
  }
  function linePrefix(prefix) {
    const s = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    ta.setRangeText(prefix, s, s, 'end'); ta.focus(); dirty = true;
  }
  $$('[data-md]', form).forEach((b) => b.addEventListener('click', async () => {
    const t = b.dataset.md;
    if (t === 'b') wrap('**'); else if (t === 'i') wrap('*');
    else if (t === 'h2') linePrefix('## '); else if (t === 'h3') linePrefix('### ');
    else if (t === 'ul') linePrefix('- '); else if (t === 'ol') linePrefix('1. '); else if (t === 'quote') linePrefix('> ');
    else if (t === 'link') { const url = prompt('Dirección del enlace (https://...)'); if (url) wrap('[', `](${url})`, 'texto del enlace'); }
    else if (t === 'img') {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = async () => {
        if (!inp.files[0]) return;
        try { toast('Subiendo imagen…'); const m = await uploadImage(inp.files[0]); ta.setRangeText(`\n![Descripción de la imagen](${m.path})\n`, ta.selectionStart, ta.selectionEnd, 'end'); dirty = true; toast('Imagen insertada'); }
        catch (e) { fail(e); }
      };
      inp.click();
    }
  }));

  // Vista previa
  $$('#mode button', form).forEach((b) => b.addEventListener('click', async () => {
    $$('#mode button', form).forEach((x) => x.classList.toggle('on', x === b));
    const prev = b.dataset.m === 'preview';
    $('#write-box', form).classList.toggle('hidden', prev);
    $('#preview-box', form).classList.toggle('hidden', !prev);
    if (prev) {
      $('#preview-box', form).innerHTML = html`<div class="spinner"></div>`;
      try {
        // El HTML ya viene limpio desde el servidor (mismo filtro que la página pública).
        const r = editable ? await POST('/api/admin/newsletters/preview', { body_md: ta.value }) : { html: n.body_html };
        $('#preview-box', form).innerHTML = r.html || '<p class="muted">Todavía no hay contenido.</p>';
      } catch (e) { fail(e); }
    }
  }));

  // Portada
  $('#cover-in', form)?.addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try { $('#cover', form).innerHTML = html`<div class="spinner"></div>`; const m = await uploadImage(f); cover = m.path; dirty = true; $('#cover', form).innerHTML = html`<img src="${cover}" alt="">`; }
    catch (e) { fail(e); $('#cover', form).textContent = cover ? '' : 'Sin portada'; }
  });
  $('#cover-rm', form)?.addEventListener('click', () => { cover = null; dirty = true; $('#cover', form).textContent = 'Sin portada'; });

  const payload = () => ({ title: form.title.value, slug: form.slug.value, summary: form.summary.value, body_md: ta.value, cover_path: cover });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await withBusy($('button[type=submit]', form), async () => {
      try {
        const saved = id ? await api('PUT', `/api/admin/newsletters/${id}`, payload()) : await POST('/api/admin/newsletters', payload());
        dirty = false; toast('Guardado');
        if (!id) location.hash = `#/newsletters/${saved.id}`; else form.slug.value = saved.slug;
      } catch (e) { fail(e); }
    });
  });
  $$('[data-status]', form).forEach((b) => b.addEventListener('click', async () => {
    const st = b.dataset.status;
    if (st === 'published' && !(await confirmDialog('¿Publicar este newsletter? Va a quedar visible en tu página.', { ok: 'Publicar' }))) return;
    try {
      if (dirty && editable) { await api('PUT', `/api/admin/newsletters/${id}`, payload()); dirty = false; }
      await POST(`/api/admin/newsletters/${id}/status`, { status: st });
      toast(st === 'published' ? 'Publicado' : st === 'archived' ? 'Archivado' : 'Pasado a borrador');
      newsletterEditor(v, id);
    } catch (e) { fail(e); }
  }));
  $('#del', form)?.addEventListener('click', async () => {
    if (!(await confirmDialog('¿Eliminar este newsletter? No se puede deshacer.', { ok: 'Eliminar', danger: true }))) return;
    try { await api('DELETE', `/api/admin/newsletters/${id}`); dirty = false; toast('Eliminado'); location.hash = '#/newsletters'; } catch (e) { fail(e); }
  });
}

// ---------- Mensajes ----------
VIEWS.mensajes = async (v, [openId]) => {
  let status = 'all', page = 1, current = openId ? Number(openId) : null;
  v.innerHTML = html`<div class="head"><div><div class="kick">Formulario de contacto</div><h1>Mensajes</h1></div></div>
    <div class="tabs" id="tabs"><button class="on" data-s="all">Bandeja</button><button data-s="new">Sin leer</button><button data-s="archived">Archivados</button></div>
    <div class="inbox"><div class="tbl-wrap" id="list"></div><div id="detail" class="card"><p class="muted">Elegí un mensaje para verlo completo.</p></div></div>`;

  async function loadList() {
    const r = await GET(`/api/admin/messages?status=${status}&page=${page}`);
    const pages = Math.max(1, Math.ceil(r.total / r.size));
    $('#list', v).innerHTML = r.items.length ? html`${r.items.map((m) => html`<button class="msg ${m.status === 'new' ? 'unread' : ''} ${m.id === current ? 'on' : ''}" data-id="${m.id}"><b>${m.name}${m.company ? ' · ' + m.company : ''}</b><div class="muted small">${fmtDate(m.created_at)}</div><div class="small">${m.preview || '(sin mensaje)'}</div></button>`)}
      ${pages > 1 ? html`<div class="pager"><button class="btn line sm" data-p="-1" ${page <= 1 ? 'disabled' : ''}>←</button><span class="small">${page} / ${pages}</span><button class="btn line sm" data-p="1" ${page >= pages ? 'disabled' : ''}>→</button></div>` : ''}`
      : html`<div class="empty">No hay mensajes acá.</div>`;
    $$('.msg', v).forEach((b) => b.addEventListener('click', () => openMsg(Number(b.dataset.id))));
    $$('[data-p]', v).forEach((b) => b.addEventListener('click', () => { page += Number(b.dataset.p); loadList().catch(fail); }));
  }

  async function openMsg(mid) {
    current = mid;
    $$('.msg', v).forEach((b) => b.classList.toggle('on', Number(b.dataset.id) === mid));
    const d = $('#detail', v);
    d.innerHTML = html`<div class="spinner"></div>`;
    try {
      const m = await GET(`/api/admin/messages/${mid}`);
      const digits = m.phone.replace(/\D/g, '');
      const wa = digits.length >= 8 ? `https://wa.me/${digits.startsWith('54') ? digits : '549' + digits.replace(/^0/, '')}` : null;
      d.innerHTML = html`<div class="stack"><div class="row between"><h2>${m.name}</h2><span class="tag ${m.status}">${m.status === 'archived' ? 'Archivado' : 'Leído'}</span></div>
        <dl class="kv"><dt>Inmobiliaria</dt><dd>${m.company || '—'}</dd><dt>Teléfono</dt><dd>${m.phone || '—'}</dd><dt>Correo</dt><dd>${m.email || '—'}</dd><dt>Recibido</dt><dd>${fmtDate(m.created_at)}</dd><dt>Origen</dt><dd>${m.source}</dd></dl>
        <div class="msg-body">${m.message || '(No escribió un mensaje)'}</div>
        <div class="row">${wa ? html`<a class="btn gold" href="${wa}" target="_blank" rel="noopener">Responder por WhatsApp</a>` : ''}${m.email ? html`<a class="btn line" href="mailto:${m.email}">Responder por mail</a>` : ''}
        ${can('messages.manage') ? html`${m.status !== 'archived' ? html`<button class="btn line" data-a="archived">Archivar</button>` : html`<button class="btn line" data-a="read">Sacar de archivados</button>`}<button class="btn line" data-a="new">Marcar como no leído</button><button class="btn danger" data-a="del">Eliminar</button>` : ''}</div></div>`;
      $$('[data-a]', d).forEach((b) => b.addEventListener('click', async () => {
        try {
          if (b.dataset.a === 'del') {
            if (!(await confirmDialog('¿Eliminar este mensaje para siempre?', { ok: 'Eliminar', danger: true }))) return;
            await api('DELETE', `/api/admin/messages/${mid}`); d.innerHTML = html`<p class="muted">Mensaje eliminado.</p>`; current = null;
          } else { await api('PATCH', `/api/admin/messages/${mid}`, { status: b.dataset.a }); toast('Listo'); }
          await loadList(); refreshBadge();
          if (b.dataset.a !== 'del' && b.dataset.a !== 'new') openMsg(mid);
        } catch (e) { fail(e); }
      }));
      await loadList(); refreshBadge();
    } catch (e) { d.innerHTML = html`<div class="err">${e.message}</div>`; }
  }

  $$('#tabs button', v).forEach((b) => b.addEventListener('click', () => { $$('#tabs button', v).forEach((x) => x.classList.toggle('on', x === b)); status = b.dataset.s; page = 1; loadList().catch(fail); }));
  await loadList();
  if (current) openMsg(current);
};

// ---------- Estadísticas ----------
VIEWS.estadisticas = async (v) => {
  const list = await GET('/api/admin/stats/newsletters');
  const u = state.umami || {};
  const max = Math.max(1, ...list.map((n) => n.views));
  v.innerHTML = html`<div class="head"><div><div class="kick">Visitas</div><h1>Estadísticas</h1></div>${u.dashboard ? html`<a class="btn line" href="${u.dashboard}" target="_blank" rel="noopener">Abrir Umami ↗</a>` : ''}</div>
    <div class="card stack"><h3>Lecturas por newsletter</h3>
      ${list.length ? html`<table class="tbl"><tbody>${list.map((n) => html`<tr><td><b>${n.title}</b><div class="muted small">${fmtDate(n.published_at, false)}</div></td><td class="bar-cell"><meter min="0" max="${max}" value="${n.views}"></meter></td><td><b>${n.views}</b></td><td><a href="/newsletter/${n.slug}" target="_blank" rel="noopener">Ver ↗</a></td></tr>`)}</tbody></table>`
        : html`<p class="muted">Todavía no hay newsletters publicados.</p>`}
      <span class="hint">Cuenta las aperturas de cada artículo (sin contar robots de buscadores). El detalle completo está en Umami.</span></div>
    <div class="stack">
      ${u.share ? html`<h3>Visitas de la página (Umami)</h3><iframe class="frame" src="${u.share}" title="Estadísticas de Umami" loading="lazy" referrerpolicy="no-referrer"></iframe>`
        : html`<div class="card"><h3>Visitas de la página</h3><p class="muted">${u.dashboard ? 'Abrí Umami para ver visitas, países, dispositivos y páginas más vistas. Si activás el link para compartir de Umami, el resumen se muestra acá mismo.' : 'Umami todavía no está configurado.'}</p></div>`}
    </div>`;
};

// ---------- Usuarios ----------
VIEWS.usuarios = async (v) => {
  const [users, roles] = await Promise.all([GET('/api/admin/users'), GET('/api/admin/roles')]);
  const manage = can('users.manage');
  v.innerHTML = html`<div class="head"><div><div class="kick">Accesos</div><h1>Usuarios</h1></div>${manage ? html`<button class="btn gold" id="new">+ Nuevo usuario</button>` : ''}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Roles</th><th>Estado</th><th>2 pasos</th><th>Último ingreso</th>${manage ? html`<th></th>` : ''}</tr></thead><tbody>
    ${users.map((u) => html`<tr><td><b>${u.name}</b><div class="muted small">${u.email}</div></td><td>${u.roles.map((r) => r.name).join(', ') || '—'}</td>
      <td>${!u.is_active ? html`<span class="tag off">Desactivado</span>` : u.locked_until && new Date(u.locked_until) > new Date() ? html`<span class="tag danger">Bloqueado</span>` : u.must_change_password ? html`<span class="tag new">Debe cambiar clave</span>` : html`<span class="tag on">Activo</span>`}</td>
      <td>${u.totp_enabled ? html`<span class="tag on">Activa</span>` : html`<span class="tag draft">No</span>`}</td><td>${fmtDate(u.last_login_at)}</td>
      ${manage ? html`<td><button class="btn line sm" data-edit="${u.id}">Editar</button></td>` : ''}</tr>`)}
    </tbody></table></div>`;

  const roleChecks = (selected = []) => html`${roles.map((r) => html`<label class="chk"><input type="checkbox" name="roles" value="${r.key}" ${selected.includes(r.key) ? 'checked' : ''}><span><b>${r.name}</b><br><span class="muted small">${r.description}</span></span></label>`)}`;
  const showTemp = (title, pw) => modal(html`<h3>${title}</h3><p>Pasale esta contraseña temporal por un medio seguro. Al entrar, va a tener que elegir una propia y activar la verificación en dos pasos.</p><p class="secret">${pw}</p><p class="hint">No se vuelve a mostrar.</p><div class="row end"><button class="btn" data-copy>Copiar</button><button class="btn line" data-close>Listo</button></div>`,
    (root) => $('[data-copy]', root).addEventListener('click', () => navigator.clipboard.writeText(pw).then(() => toast('Copiada'))));

  $('#new', v)?.addEventListener('click', () => modal(html`<h3>Nuevo usuario</h3><form class="stack" data-f>
      <label class="f">Nombre<input class="in" name="name" required maxlength="120"></label>
      <label class="f">Correo<input class="in" name="email" type="email" required maxlength="200"></label>
      <div><span class="f">Roles</span>${roleChecks(['editor'])}</div><div data-e></div>
      <div class="row end"><button type="button" class="btn line" data-close>Cancelar</button><button class="btn" type="submit">Crear usuario</button></div></form>`,
    (root, close) => {
      const f = $('[data-f]', root);
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const rs = $$('input[name=roles]:checked', f).map((x) => x.value);
        try { const r = await POST('/api/admin/users', { name: f.name.value, email: f.email.value, roles: rs }); close(); showTemp(`Usuario creado: ${r.user.email}`, r.tempPassword); VIEWS.usuarios(v); }
        catch (e) { $('[data-e]', f).innerHTML = html`<div class="err">${e.message}</div>`; }
      });
    }));

  $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => {
    const u = users.find((x) => x.id === Number(b.dataset.edit));
    const self = u.id === state.me.id;
    modal(html`<h3>${u.name}</h3><p class="muted small">${u.email}</p><form class="stack" data-f>
        <label class="f">Nombre<input class="in" name="name" required value="${u.name}"></label>
        ${self ? html`<p class="hint">No podés cambiar tus propios roles ni desactivarte.</p>` : html`<div><span class="f">Roles</span>${roleChecks(u.roles.map((r) => r.key))}</div>
          <label class="chk"><input type="checkbox" name="active" ${u.is_active ? 'checked' : ''}><span>Usuario activo</span></label>`}
        <div data-e></div>
        <div class="row end"><button type="button" class="btn line" data-close>Cancelar</button><button class="btn" type="submit">Guardar</button></div></form>
        ${self ? '' : html`<hr><div class="stack"><span class="f">Acciones de seguridad</span><div class="row"><button class="btn line sm" data-x="reset-password">Nueva contraseña temporal</button>${u.totp_enabled ? html`<button class="btn line sm" data-x="reset-2fa">Reiniciar 2 pasos</button>` : ''}<button class="btn line sm" data-x="unlock">Desbloquear</button></div></div>`}`,
    (root, close) => {
      const f = $('[data-f]', root);
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const body = { name: f.name.value };
        if (!self) { body.roles = $$('input[name=roles]:checked', f).map((x) => x.value); body.is_active = f.active.checked; }
        try { await api('PATCH', `/api/admin/users/${u.id}`, body); close(); toast('Usuario actualizado'); VIEWS.usuarios(v); }
        catch (e) { $('[data-e]', f).innerHTML = html`<div class="err">${e.message}</div>`; }
      });
      $$('[data-x]', root).forEach((x) => x.addEventListener('click', async () => {
        const act = x.dataset.x;
        const msg = { 'reset-password': '¿Generar una contraseña temporal nueva? Se cierran sus sesiones.', 'reset-2fa': '¿Reiniciar la verificación en dos pasos? La va a tener que configurar de nuevo.', unlock: '¿Desbloquear este usuario?' }[act];
        if (!(await confirmDialog(msg))) return;
        try {
          const r = await POST(`/api/admin/users/${u.id}/${act}`);
          close();
          if (r.tempPassword) showTemp('Contraseña temporal', r.tempPassword); else toast('Listo');
          VIEWS.usuarios(v);
        } catch (e) { fail(e); }
      }));
    });
  }));
};

// ---------- Roles ----------
VIEWS.roles = async (v) => {
  const [roles, perms] = await Promise.all([GET('/api/admin/roles'), GET('/api/admin/permissions')]);
  const manage = can('roles.manage');
  const groups = [...new Set(perms.map((p) => p.grp))];
  v.innerHTML = html`<div class="head"><div><div class="kick">Accesos</div><h1>Roles y permisos</h1></div>${manage ? html`<button class="btn gold" id="new">+ Nuevo rol</button>` : ''}</div>
    <div class="cards">${roles.map((r) => html`<div class="card stack"><div><h3>${r.name}</h3><p class="muted small">${r.description || 'Sin descripción'}</p></div>
      <span class="small"><b>${r.permissions.length}</b> permisos · <b>${r.users}</b> usuario(s)</span>
      ${manage ? html`<div class="row"><button class="btn line sm" data-edit="${r.id}">${r.key === 'admin' ? 'Ver' : 'Editar'}</button>${!r.is_system ? html`<button class="btn danger sm" data-del="${r.id}">Borrar</button>` : ''}</div>` : ''}</div>`)}</div>
    <p class="hint">Los roles nuevos sirven para sumar colaboradores con acceso solo a lo que necesitan. Nadie puede dar permisos que no tiene.</p>`;

  const editor = (r) => modal(html`<h3>${r ? r.name : 'Nuevo rol'}</h3><form class="stack" data-f>
      <label class="f">Nombre<input class="in" name="name" required maxlength="60" value="${r?.name || ''}"></label>
      <label class="f">Descripción<input class="in" name="description" maxlength="200" value="${r?.description || ''}"></label>
      <div>${groups.map((g) => html`<div class="perm-grp"><h4>${g}</h4>${perms.filter((p) => p.grp === g).map((p) => html`<label class="chk"><input type="checkbox" name="perm" value="${p.key}" ${r?.permissions.includes(p.key) ? 'checked' : ''} ${r?.key === 'admin' ? 'disabled' : ''}><span>${p.description}</span></label>`)}</div>`)}</div>
      ${r?.key === 'admin' ? html`<p class="hint">El rol Administrador siempre tiene todos los permisos.</p>` : ''}
      <div data-e></div>
      <div class="row end"><button type="button" class="btn line" data-close>Cancelar</button><button class="btn" type="submit">Guardar</button></div></form>`,
  (root, close) => {
    const f = $('[data-f]', root);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = { name: f.name.value, description: f.description.value, permissions: $$('input[name=perm]:checked', f).map((x) => x.value) };
      try { if (r) await api('PUT', `/api/admin/roles/${r.id}`, body); else await POST('/api/admin/roles', body); close(); toast('Rol guardado'); VIEWS.roles(v); }
      catch (e) { $('[data-e]', f).innerHTML = html`<div class="err">${e.message}</div>`; }
    });
  });
  $('#new', v)?.addEventListener('click', () => editor(null));
  $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => editor(roles.find((r) => r.id === Number(b.dataset.edit)))));
  $$('[data-del]', v).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('¿Borrar este rol?', { ok: 'Borrar', danger: true }))) return;
    try { await api('DELETE', `/api/admin/roles/${b.dataset.del}`); toast('Rol borrado'); VIEWS.roles(v); } catch (e) { fail(e); }
  }));
};

// ---------- Actividad ----------
const ACTIONS = {
  'login.ok': 'Inició sesión', 'login.fail': 'Intento de ingreso fallido', 'login.lock': 'Cuenta bloqueada por intentos', 'login.locked': 'Intento con cuenta bloqueada', 'login.2fa_fail': 'Código de 2 pasos incorrecto',
  logout: 'Cerró sesión', 'password.change': 'Cambió su contraseña', '2fa.enable': 'Activó 2 pasos', '2fa.disable': 'Desactivó 2 pasos', 'sessions.close_others': 'Cerró otras sesiones',
  'newsletter.create': 'Creó un newsletter', 'newsletter.update': 'Editó un newsletter', 'newsletter.published': 'Publicó un newsletter', 'newsletter.draft': 'Pasó a borrador un newsletter', 'newsletter.archived': 'Archivó un newsletter', 'newsletter.delete': 'Eliminó un newsletter',
  'media.upload': 'Subió una imagen', 'message.archived': 'Archivó un mensaje', 'message.read': 'Marcó un mensaje como leído', 'message.new': 'Marcó un mensaje como no leído', 'message.delete': 'Eliminó un mensaje',
  'user.create': 'Creó un usuario', 'user.update': 'Editó un usuario', 'user.reset_password': 'Reinició la contraseña de un usuario', 'user.reset_2fa': 'Reinició los 2 pasos de un usuario', 'user.unlock': 'Desbloqueó un usuario',
  'role.create': 'Creó un rol', 'role.update': 'Editó un rol', 'role.delete': 'Borró un rol'
};
VIEWS.actividad = async (v) => {
  let page = 1;
  async function load() {
    const rows = await GET(`/api/admin/audit?page=${page}`);
    v.innerHTML = html`<div class="head"><div><div class="kick">Seguridad</div><h1>Actividad</h1></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Quién</th><th>Qué hizo</th><th>Detalle</th><th>IP</th></tr></thead><tbody>
      ${rows.map((a) => html`<tr><td class="small">${fmtDate(a.created_at)}</td><td>${a.user_name || html`<span class="muted">—</span>`}</td><td>${ACTIONS[a.action] || a.action}${a.action.includes('fail') || a.action.includes('lock') ? html` <span class="tag danger">!</span>` : ''}</td><td class="small muted">${a.details?.title || a.details?.email || a.details?.name || (a.entity ? `${a.entity} #${a.entity_id}` : '')}</td><td class="small">${a.ip || ''}</td></tr>`)}
      </tbody></table></div>
      <div class="pager"><button class="btn line sm" data-p="-1" ${page <= 1 ? 'disabled' : ''}>← Más nuevos</button><button class="btn line sm" data-p="1" ${rows.length < 50 ? 'disabled' : ''}>Más viejos →</button></div>`;
    $$('[data-p]', v).forEach((b) => b.addEventListener('click', () => { page += Number(b.dataset.p); load().catch(fail); }));
  }
  await load();
};

// ---------- Mi cuenta ----------
VIEWS.cuenta = async (v) => {
  const sessions = await GET('/api/auth/sessions');
  v.innerHTML = html`<div class="head"><div><div class="kick">Mi cuenta</div><h1>${state.me.name}</h1><p class="muted">${state.me.email} · ${state.me.roles.map((r) => r.name).join(', ')}</p></div></div>
    <div class="two">
      <div class="card"><h3>Cambiar contraseña</h3>${passwordForm('pf')}</div>
      <div class="stack">
        <div class="card stack"><h3>Verificación en dos pasos</h3>
          ${state.me.totpEnabled ? html`<p><span class="tag on">Activa</span> Tu cuenta pide un código del celular al entrar.</p><button class="btn line" id="dis">Desactivar</button>` : html`<p class="muted">Activala para proteger tu cuenta.</p><div id="tf"></div>`}</div>
        <div class="card stack"><h3>Sesiones abiertas</h3>
          ${sessions.map((s) => html`<div class="list-item"><b>${/Mobile|Android|iPhone/i.test(s.user_agent || '') ? 'Celular' : 'Computadora'} ${s.current ? html`<span class="tag on">Esta sesión</span>` : ''}</b><span class="muted small">${s.ip || ''} · última actividad ${fmtDate(s.last_seen_at)}</span></div>`)}
          ${sessions.length > 1 ? html`<button class="btn line" id="others">Cerrar las demás sesiones</button>` : ''}</div>
      </div>
    </div>`;
  bindPasswordForm($('#pf', v));
  if (!state.me.totpEnabled) twoFactorSetup($('#tf', v), boot);
  $('#others', v)?.addEventListener('click', async () => { try { const r = await POST('/api/auth/sessions/close-others'); toast(`Se cerraron ${r.closed} sesión(es)`); VIEWS.cuenta(v); } catch (e) { fail(e); } });
  $('#dis', v)?.addEventListener('click', () => modal(html`<h3>Desactivar verificación en dos pasos</h3><p class="muted">Confirmá con tu contraseña y un código de la app.</p><form class="stack" data-f>
      <label class="f">Contraseña<input class="in" type="password" name="password" required autocomplete="current-password"></label>
      <label class="f">Código<input class="in code-in" name="code" inputmode="numeric" maxlength="6" required></label><div data-e></div>
      <div class="row end"><button type="button" class="btn line" data-close>Cancelar</button><button class="btn danger" type="submit">Desactivar</button></div></form>`,
  (root, close) => {
    const f = $('[data-f]', root);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { await POST('/api/auth/2fa/disable', formData(f)); close(); toast('Verificación en dos pasos desactivada'); boot(); }
      catch (e) { $('[data-e]', f).innerHTML = html`<div class="err">${e.message}</div>`; }
    });
  }));
};

boot();
