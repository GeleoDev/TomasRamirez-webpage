// Configuración leída de variables de entorno (archivo .env) y validada al arrancar.
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(3100),
  DATABASE_URL: z.string().min(1),
  // Clave de 64 caracteres hex para cifrar datos sensibles (secretos 2FA). Generar con: openssl rand -hex 32
  SECRET_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'SECRET_KEY debe tener 64 caracteres hexadecimales'),
  PUBLIC_URL: z.string().url().default('http://localhost:3100'),
  // Orígenes desde los que se aceptan pedidos que modifican datos (separados por coma).
  ALLOWED_ORIGINS: z.string().default(''),
  UPLOAD_DIR: z.string().default('./uploads'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).default(60),
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).default(12),
  REQUIRE_2FA: bool.default('true'),
  LOGIN_MAX_FAILS: z.coerce.number().int().min(3).default(5),
  // Intentos de login por IP cada 15 minutos.
  LOGIN_RATE_MAX: z.coerce.number().int().min(1).default(10),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
  TRUST_PROXY: bool.default('true'),
  // Umami (estadísticas). Vacíos = desactivado.
  UMAMI_SCRIPT_URL: z.string().default(''),
  UMAMI_WEBSITE_ID: z.string().default(''),
  UMAMI_DASHBOARD_URL: z.string().default(''),
  UMAMI_SHARE_URL: z.string().default(''),
  SITE_NAME: z.string().default('TomasRamirezDev')
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuración inválida:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const c = parsed.data;
export const config = {
  ...c,
  isProd: c.NODE_ENV === 'production',
  allowedOrigins: new Set(
    [c.PUBLIC_URL, ...c.ALLOWED_ORIGINS.split(',')].map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
  )
};
