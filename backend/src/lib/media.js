// Guarda imágenes subidas: se re-codifican siempre a WebP (descarta metadatos y cualquier contenido que no sea imagen).
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { randomToken } from '../security/crypto.js';
import { HttpError } from './errors.js';

const MAX_BYTES = 10 * 1024 * 1024;
const OK_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export async function storeImage(buffer, mimetype) {
  if (!OK_MIME.has(mimetype)) throw new HttpError(400, 'Solo se aceptan imágenes JPG, PNG, WebP, GIF o AVIF.');
  if (buffer.length > MAX_BYTES) throw new HttpError(413, 'La imagen pesa más de 10 MB.');
  let out;
  try {
    out = await sharp(buffer, { limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new HttpError(400, 'El archivo no es una imagen válida.');
  }
  const now = new Date();
  const sub = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const name = `${randomToken(12).replace(/[^a-zA-Z0-9]/g, 'x')}.webp`;
  const dir = path.resolve(config.UPLOAD_DIR, sub);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), out.data, { mode: 0o644 });
  return { path: `/uploads/${sub}/${name}`, width: out.info.width, height: out.info.height, size: out.data.length };
}
