// Plantillas HTML de las páginas públicas del newsletter. Todo texto variable pasa por esc().
import { config } from '../config.js';
import { esc, readingMinutes } from '../lib/content.js';

const LOGO = `<svg viewBox="25 110 608 320" width="46" height="24" aria-hidden="true"><path fill="#E2C27A" d="M182.227 353.849 L39.141 280.193 L39.141 251.256 L182.227 177.601 L182.227 208.729 L114.718 242.926 L75.969 264.848 L75.969 266.601 L114.718 288.523 L182.227 322.72 Z"/><path fill="#E2C27A" d="M475.39 177.601 L618.476 251.256 L618.476 280.193 L475.39 353.849 L475.39 322.72 L542.899 288.523 L581.648 266.601 L581.648 264.848 L542.899 242.926 L475.39 208.729 Z"/><path fill="#F7F3EA" d="M159.558 151.941 L145.558 122.228 L363.024 123.228 L349.024 151.941 L273.319 151.941 L273.319 417.431 L235.263 417.431 L235.263 151.941 Z"/><path fill="#F7F3EA" d="M354.575 153.411 L368.512 124.144 C370.705 124.789 372.854 125.488 374.961 126.24 C389.756 131.526 401.35 140.285 409.743 152.517 C418.137 164.75 422.333 181.135 422.333 201.674 C422.333 224.628 416.643 243.128 405.262 257.173 C393.881 271.218 378.517 280.807 359.17 285.942 L430.442 417.515 L390.325 417.515 L322.894 290.019 L278.937 290.019 L278.937 259.212 L319.053 259.212 C340.961 259.212 357.747 254.455 369.413 244.94 C381.078 235.426 386.911 221.004 386.911 201.674 C386.911 182.041 381.078 168.299 369.413 160.446 C365.15 157.577 360.204 155.231 354.575 153.411 Z"/></svg>`;

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fecha(d) {
  const x = new Date(d);
  return `${x.getUTCDate()} de ${MONTHS[x.getUTCMonth()]} de ${x.getUTCFullYear()}`;
}

function umami() {
  if (!config.UMAMI_SCRIPT_URL || !config.UMAMI_WEBSITE_ID) return '';
  return `<script defer src="${esc(config.UMAMI_SCRIPT_URL)}" data-website-id="${esc(config.UMAMI_WEBSITE_ID)}"></script>`;
}

function layout({ title, description, canonical, image, body, noindex = false }) {
  const site = config.PUBLIC_URL.replace(/\/$/, '');
  const img = image ? site + image : `${site}/assets/img/compartir.jpg`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(site + canonical)}">`}
<meta property="og:type" content="article">
<meta property="og:locale" content="es_AR">
<meta property="og:site_name" content="TomasRamirezDev">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(site + canonical)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0E2A20">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&amp;family=Manrope:wght@400;500;600;700&amp;family=JetBrains+Mono:wght@500&amp;display=swap">
<link rel="stylesheet" href="/nl-assets/newsletter.css">
${umami()}
</head>
<body>
<header class="top"><div class="wrap top-in"><a class="brand" href="/">${LOGO}<span>TomasRamirez<b>Dev</b></span></a><nav><a href="/newsletter/">Newsletter</a><a class="btn" href="/#contacto">Escribime</a></nav></div></header>
<main>${body}</main>
<footer class="foot"><div class="wrap foot-in"><a class="brand" href="/">${LOGO}<span>TomasRamirez<b>Dev</b></span></a><span>Páginas web para inmobiliarias</span><a href="/">Volver al inicio</a></div></footer>
</body>
</html>`;
}

function card(n) {
  return `<a class="card" href="/newsletter/${esc(n.slug)}">
<div class="card-img">${n.cover_path ? `<img src="${esc(n.cover_path)}" alt="" loading="lazy">` : `<span class="card-ph">${LOGO}</span>`}</div>
<div class="card-body"><time datetime="${esc(new Date(n.published_at).toISOString())}">${esc(fecha(n.published_at))}</time><h3>${esc(n.title)}</h3>${n.summary ? `<p>${esc(n.summary)}</p>` : ''}<span class="more">Leer →</span></div>
</a>`;
}

export function listPage(items) {
  const body = `<section class="hero"><div class="wrap"><div class="kick">Newsletter</div><h1>Ideas para que tu inmobiliaria <em>se destaque</em></h1><p>Novedades, herramientas y consejos sobre páginas web y captación de clientes para inmobiliarias.</p></div></section>
<section class="wrap list">${items.length ? `<div class="grid">${items.map(card).join('')}</div>` : '<p class="empty">Muy pronto vas a encontrar acá los primeros artículos.</p>'}</section>`;
  return layout({ title: 'Newsletter · TomasRamirezDev', description: 'Novedades e ideas sobre páginas web para inmobiliarias.', canonical: '/newsletter/', body });
}

export function articlePage(n, more) {
  const body = `<article class="art">
<header class="art-head"><div class="wrap narrow"><a class="back" href="/newsletter/">← Todos los artículos</a><div class="kick">Newsletter · <time datetime="${esc(new Date(n.published_at).toISOString())}">${esc(fecha(n.published_at))}</time> · ${readingMinutes(n.body_html)} min de lectura</div><h1>${esc(n.title)}</h1>${n.summary ? `<p class="lead">${esc(n.summary)}</p>` : ''}</div></header>
${n.cover_path ? `<div class="wrap cover"><img src="${esc(n.cover_path)}" alt=""></div>` : ''}
<div class="wrap narrow prose">${n.body_html}</div>
<div class="wrap narrow cta"><div><b>¿Querés una página que te diferencie?</b><p>Contame cómo trabaja tu inmobiliaria y lo vemos juntos.</p></div><a class="btn" href="/#contacto">Escribime</a></div>
</article>
${more.length ? `<section class="wrap list"><h2 class="list-title">Seguí leyendo</h2><div class="grid">${more.map(card).join('')}</div></section>` : ''}`;
  return layout({ title: `${n.title} · TomasRamirezDev`, description: n.summary || n.title, canonical: `/newsletter/${n.slug}`, image: n.cover_path, body });
}

export function notFoundPage() {
  return layout({ title: 'No encontrado · TomasRamirezDev', description: 'Esta página no existe.', canonical: '/newsletter/', noindex: true,
    body: '<section class="hero"><div class="wrap"><div class="kick">Error 404</div><h1>Este artículo <em>no existe</em></h1><p>Puede que lo hayan movido o despublicado.</p><p><a class="btn" href="/newsletter/">Ver todos los artículos</a></p></div></section>' });
}
