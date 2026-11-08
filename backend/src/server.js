import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './migrate.js';
import { query, pool } from './db.js';

await migrate();
const app = await buildApp();

// Limpieza periódica: sesiones vencidas y actividad de más de 1 año.
const cleanup = async () => {
  try {
    await query('DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - make_interval(mins => $1)', [config.SESSION_IDLE_MINUTES]);
    await query("DELETE FROM audit_log WHERE created_at < now() - interval '365 days'");
  } catch (e) { app.log.error(e); }
};
setInterval(cleanup, 60 * 60 * 1000).unref();
cleanup();

await app.listen({ host: config.HOST, port: config.PORT });

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => { await app.close(); await pool.end(); process.exit(0); });
}
