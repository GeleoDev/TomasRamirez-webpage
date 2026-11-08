// Markdown → HTML seguro, slugs y escape para las plantillas.
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({ gfm: true, breaks: true });

const ALLOWED = {
  allowedTags: ['h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
  allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title'] },
  allowedSchemes: ['https', 'http', 'mailto', 'tel'],
  allowedSchemesByTag: { img: [] },
  allowProtocolRelative: false,
  // Las imágenes solo pueden venir de las subidas del propio panel.
  exclusiveFilter: (frame) => frame.tag === 'img' && !/^\/uploads\/[\w/-]+\.webp$/.test(frame.attribs.src || ''),
  transformTags: {
    h1: 'h2',
    a: (tag, attribs) => {
      const href = attribs.href || '';
      const external = /^https?:\/\//i.test(href) && !/^https:\/\/(www\.)?tomasramirezdev\.com/i.test(href);
      return { tagName: 'a', attribs: { ...attribs, ...(external ? { rel: 'noopener noreferrer nofollow', target: '_blank' } : {}) } };
    },
    img: (tag, attribs) => ({ tagName: 'img', attribs: { ...attribs, loading: 'lazy', decoding: 'async' } })
  }
};
ALLOWED.allowedAttributes.a.push('rel', 'target');
ALLOWED.allowedAttributes.img.push('loading', 'decoding');

export function renderMarkdown(md) {
  return sanitizeHtml(marked.parse(String(md || '')), ALLOWED);
}

export function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'newsletter';
}

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => MAP[c]);

export function readingMinutes(html) {
  const words = String(html).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
