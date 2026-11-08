-- 001 · Esquema inicial: usuarios, roles, permisos, sesiones, auditoría,
-- newsletters, archivos subidos, mensajes de contacto y ajustes.

CREATE TABLE users (
  id                    BIGSERIAL PRIMARY KEY,
  email                 TEXT        NOT NULL,
  name                  TEXT        NOT NULL,
  password_hash         TEXT        NOT NULL,
  is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
  must_change_password  BOOLEAN     NOT NULL DEFAULT FALSE,
  totp_secret           TEXT,
  totp_pending_secret   TEXT,
  totp_enabled          BOOLEAN     NOT NULL DEFAULT FALSE,
  totp_last_step        BIGINT,
  failed_logins         INTEGER     NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  password_changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE roles (
  id           BIGSERIAL PRIMARY KEY,
  key          TEXT        NOT NULL UNIQUE,
  name         TEXT        NOT NULL,
  description  TEXT        NOT NULL DEFAULT '',
  is_system    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  key          TEXT PRIMARY KEY,
  grp          TEXT NOT NULL,
  description  TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id         BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key  TEXT   NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE user_roles (
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id  BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- La cookie lleva un token aleatorio; acá solo se guarda su hash SHA-256.
CREATE TABLE sessions (
  id            TEXT        PRIMARY KEY,
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token    TEXT        NOT NULL,
  mfa_pending   BOOLEAN     NOT NULL DEFAULT FALSE,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT        NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  ip          TEXT,
  details     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_user_idx ON audit_log (user_id);

CREATE TABLE media (
  id             BIGSERIAL PRIMARY KEY,
  path           TEXT        NOT NULL UNIQUE,
  original_name  TEXT        NOT NULL,
  mime           TEXT        NOT NULL,
  width          INTEGER,
  height         INTEGER,
  size_bytes     INTEGER     NOT NULL,
  uploaded_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE newsletters (
  id            BIGSERIAL PRIMARY KEY,
  slug          TEXT        NOT NULL UNIQUE,
  title         TEXT        NOT NULL,
  summary       TEXT        NOT NULL DEFAULT '',
  body_md       TEXT        NOT NULL DEFAULT '',
  body_html     TEXT        NOT NULL DEFAULT '',
  cover_path    TEXT,
  status        TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at  TIMESTAMPTZ,
  author_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX newsletters_pub_idx ON newsletters (status, published_at DESC);

CREATE TABLE contact_messages (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  company     TEXT        NOT NULL DEFAULT '',
  phone       TEXT        NOT NULL DEFAULT '',
  email       TEXT        NOT NULL DEFAULT '',
  message     TEXT        NOT NULL DEFAULT '',
  source      TEXT        NOT NULL DEFAULT 'landing',
  status      TEXT        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
  ip          TEXT,
  user_agent  TEXT,
  read_at     TIMESTAMPTZ,
  read_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contact_status_idx ON contact_messages (status, created_at DESC);

-- Ajustes generales para funciones futuras (clave → valor JSON).
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permisos y roles base ---------------------------------------------------
INSERT INTO permissions (key, grp, description) VALUES
  ('newsletters.read',    'Newsletters',   'Ver newsletters, incluidos borradores'),
  ('newsletters.write',   'Newsletters',   'Crear y editar newsletters'),
  ('newsletters.publish', 'Newsletters',   'Publicar y despublicar newsletters'),
  ('newsletters.delete',  'Newsletters',   'Eliminar newsletters'),
  ('media.upload',        'Archivos',      'Subir imágenes'),
  ('messages.read',       'Mensajes',      'Ver mensajes del formulario'),
  ('messages.manage',     'Mensajes',      'Archivar y eliminar mensajes'),
  ('users.read',          'Usuarios',      'Ver usuarios'),
  ('users.manage',        'Usuarios',      'Crear, editar y desactivar usuarios'),
  ('roles.manage',        'Usuarios',      'Crear y editar roles y permisos'),
  ('audit.read',          'Seguridad',     'Ver el registro de actividad'),
  ('stats.read',          'Estadísticas',  'Ver estadísticas de visitas');

INSERT INTO roles (key, name, description, is_system) VALUES
  ('admin',  'Administrador', 'Acceso total al panel.', TRUE),
  ('editor', 'Editor',        'Escribe y publica newsletters.', FALSE),
  ('lector', 'Solo lectura',  'Ve contenidos, mensajes y estadísticas sin modificar nada.', FALSE);

INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, p.key FROM roles r CROSS JOIN permissions p WHERE r.key = 'admin';
INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, p FROM roles r, unnest(ARRAY['newsletters.read','newsletters.write','newsletters.publish','media.upload','stats.read']) p WHERE r.key = 'editor';
INSERT INTO role_permissions (role_id, permission_key)
  SELECT r.id, p FROM roles r, unnest(ARRAY['newsletters.read','messages.read','stats.read']) p WHERE r.key = 'lector';
