// Verificación en dos pasos con apps tipo Google Authenticator / Authy.
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { config } from '../config.js';

function make(secretBase32, label) {
  return new OTPAuth.TOTP({
    issuer: config.SITE_NAME,
    label: label || 'admin',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32)
  });
}

export function newSecret() {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export async function qrFor(secretBase32, email) {
  const uri = make(secretBase32, email).toString();
  return { uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

// Devuelve el "paso" de tiempo usado (para impedir reutilizar el mismo código) o null.
export function checkCode(secretBase32, code, lastStep) {
  const token = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(token)) return null;
  const delta = make(secretBase32).validate({ token, window: 1 });
  if (delta === null) return null;
  const step = Math.floor(Date.now() / 1000 / 30) + delta;
  if (lastStep && step <= lastStep) return null;
  return step;
}
