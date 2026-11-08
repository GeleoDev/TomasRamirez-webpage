export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.statusCode = status;
    this.code = code || undefined;
  }
}

// Valida con zod y devuelve un 400 legible.
export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path?.join('.') || 'datos';
    throw new HttpError(400, `Dato inválido (${where}): ${first?.message || 'revisá el formulario'}`);
  }
  return r.data;
}
