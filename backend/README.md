# Panel de tomasramirezdev.com

API y panel de administración en **Node.js (Fastify) + PostgreSQL**. Corre en el VPS en `127.0.0.1:3100`, detrás de nginx.

## Qué hace

| Parte | Dirección |
|---|---|
| Panel de administración | `https://tomasramirezdev.com/admin/` |
| Newsletters públicos | `https://tomasramirezdev.com/newsletter/` |
| API pública (landing) | `/api/public/newsletters`, `/api/public/contact` |
| Estadísticas (Umami) | `https://estadisticas.tomasramirezdev.com` |

- **Newsletters:** se escriben en Markdown desde el panel, con portada e imágenes. Borrador → Publicado → Archivado. Las páginas se arman en el servidor (buenas para Google y para compartir por WhatsApp) y cuentan lecturas.
- **Mensajes:** el formulario de la landing guarda cada consulta en el panel y además la manda por mail con FormSubmit.
- **Usuarios, roles y permisos:** roles editables (Administrador, Editor, Solo lectura y los que crees). 12 permisos por área.
- **Actividad:** registro de ingresos, intentos fallidos y cambios.

## Seguridad

- Contraseñas con **Argon2id** (mínimo 12 caracteres, sin contener el correo).
- **Verificación en dos pasos (TOTP) obligatoria**; el secreto se guarda cifrado (AES-256-GCM) y cada código sirve una sola vez.
- Sesiones en cookie `__Host-` *HttpOnly + Secure + SameSite=Strict*; en la base solo se guarda el hash del token. Vencen por inactividad (60 min) y a las 12 h.
- **CSRF**: token por sesión en el encabezado `x-csrf-token` + verificación de origen.
- **Bloqueo** de la cuenta después de 5 intentos (15 min) y límite de pedidos por IP (Fastify + nginx).
- Contenido de newsletters **filtrado** (sin scripts, iframes ni imágenes externas). Las imágenes subidas se re-codifican a WebP: un archivo que no es imagen nunca llega al disco.
- Cabeceras CSP estrictas, HSTS, nosniff, sin iframes de terceros.
- Permisos chequeados en el servidor en cada ruta; nadie puede dar permisos que no tiene ni dejar el sistema sin administradores.
- Servicio aislado con systemd (solo escribe en la carpeta de imágenes) y copia de seguridad diaria (14 días) en `/var/backups/tomasramirezdev`.

## Comandos (en el VPS)

```bash
systemctl status tomasramirezdev-panel        # ver si está funcionando
journalctl -u tomasramirezdev-panel -n 100     # ver registros
cd /opt/tomasramirezdev-panel && sudo -u trpanel node --env-file=.env scripts/create-admin.js   # crear/recuperar admin
/usr/local/bin/tomasramirezdev-backup          # copia de seguridad manual
```

Actualizar: subir el paquete nuevo y correr `bash deploy/install.sh` (no toca `.env` ni las imágenes).

## Desarrollo local

```bash
cp .env.example .env    # completar DATABASE_URL y SECRET_KEY (openssl rand -hex 32), NODE_ENV=development
npm install
npm run create-admin
npm run dev             # http://localhost:3100/admin/
npm test                # pruebas de API y seguridad (usa .env.test)
```

## Cómo sumar funciones nuevas

1. **Base de datos:** agregar `migrations/00X_nombre.sql` (se aplica sola al arrancar).
2. **Permisos:** insertarlos en la misma migración (`INSERT INTO permissions ...`) y asignarlos al rol `admin`.
3. **API:** nuevo archivo en `src/routes/`, registrado en `src/app.js`, protegido con `requirePerm('area.accion')`.
4. **Panel:** nueva sección en `SECTIONS` y `VIEWS` de `admin/app.js`.
5. **Ajustes generales:** tabla `settings` (clave → JSON) ya disponible.
