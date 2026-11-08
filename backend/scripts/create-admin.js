// Crea (o repara) el primer administrador desde la terminal del servidor.
// Uso: npm run create-admin
import readline from 'node:readline';
import { migrate } from '../src/migrate.js';
import { pool, tx } from '../src/db.js';
import { hashPassword, passwordProblem } from '../src/security/password.js';

function ask(q, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); else rl.output.write('*'); };
  }
  return new Promise((res) => rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); res(a.trim()); }));
}

await migrate({ log: () => {} });
const email = process.env.ADMIN_EMAIL || await ask('Correo del administrador: ');
const name = process.env.ADMIN_NAME || await ask('Nombre: ');
let password = process.env.ADMIN_PASSWORD;
while (!password) {
  const a = await ask('Contraseña (mínimo 12 caracteres): ', true);
  const problem = passwordProblem(a, email);
  if (problem) { console.log(problem); continue; }
  const b = await ask('Repetí la contraseña: ', true);
  if (a !== b) { console.log('No coinciden.'); continue; }
  password = a;
}
const problem = passwordProblem(password, email);
if (problem) { console.error(problem); process.exit(1); }

await tx(async (c) => {
  const hash = await hashPassword(password);
  const u = (await c.query(
    `INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3)
     ON CONFLICT ((lower(email))) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE, failed_logins = 0, locked_until = NULL
     RETURNING id`, [email, name || 'Administrador', hash])).rows[0];
  await c.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = 'admin' ON CONFLICT DO NOTHING`, [u.id]);
});
console.log(`Listo: ${email} es administrador. Entrá al panel en /admin/ y activá la verificación en dos pasos.`);
await pool.end();
