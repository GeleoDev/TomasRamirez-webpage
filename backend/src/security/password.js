import argon2 from 'argon2';

// Argon2id con parámetros por encima del mínimo recomendado por OWASP.
const OPTS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };

let dummyHash;
export async function hashPassword(pw) {
  return argon2.hash(pw, OPTS);
}

export async function verifyPassword(hash, pw) {
  try {
    return await argon2.verify(hash, pw);
  } catch {
    return false;
  }
}

// Para que "usuario inexistente" tarde lo mismo que "contraseña incorrecta".
export async function burnTime(pw) {
  dummyHash ||= await argon2.hash('tiempo-constante-' + Date.now(), OPTS);
  await verifyPassword(dummyHash, pw || 'x');
}

export function passwordProblem(pw, email = '') {
  if (typeof pw !== 'string' || pw.length < 12) return 'La contraseña tiene que tener al menos 12 caracteres.';
  if (pw.length > 200) return 'La contraseña es demasiado larga.';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'La contraseña no puede contener tu correo.';
  if (/^(.)\1+$/.test(pw)) return 'La contraseña es demasiado simple.';
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length < 16 && kinds < 3) return 'Usá al menos 3 de estos: minúsculas, mayúsculas, números y símbolos (o una frase de 16+ caracteres).';
  return null;
}
