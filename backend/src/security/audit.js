import { query } from '../db.js';

// Registra una acción en el historial de actividad. Nunca rompe la petición si falla.
export async function audit(req, action, { entity = null, entityId = null, details = {}, userId } = {}) {
  try {
    await query(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, ip, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId !== undefined ? userId : req?.user?.id ?? null, action, entity, entityId == null ? null : String(entityId), req?.ip ?? null, details]
    );
  } catch (e) {
    req?.log?.error({ err: e }, 'No se pudo registrar auditoría');
  }
}
