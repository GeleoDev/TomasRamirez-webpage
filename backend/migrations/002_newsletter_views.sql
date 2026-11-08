-- 002 · Contador simple de lecturas por newsletter (además de Umami).
ALTER TABLE newsletters ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
