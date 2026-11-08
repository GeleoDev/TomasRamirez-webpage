#!/usr/bin/env bash
# Instala o actualiza el panel de tomasramirezdev.com en el VPS. Se puede correr varias veces.
# Uso (como root):  bash deploy/install.sh
set -euo pipefail

APP=/opt/tomasramirezdev-panel
SITE=/var/www/tomasramirezdev
UPLOADS=/var/www/tomasramirezdev-uploads
BACKUPS=/var/backups/tomasramirezdev
SVC=tomasramirezdev-panel
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # carpeta "backend" del paquete
BUNDLE="$(cd "$HERE/.." && pwd)"           # raíz del paquete (contiene "sitio")

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || die "Correlo como root."

say "1/9 Node.js"
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge 20 ] || die "Hace falta Node 20 o más (hay $(node -v)). No lo actualizo solo para no afectar otros proyectos."
echo "Node $(node -v)"

say "2/9 PostgreSQL"
if ! command -v psql >/dev/null; then
  apt-get update -qq && apt-get install -y postgresql
fi
systemctl enable --now postgresql >/dev/null

say "3/9 Usuario del sistema y carpetas"
id trpanel >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin trpanel
mkdir -p "$APP" "$UPLOADS" "$BACKUPS" "$SITE"
chown trpanel:trpanel "$UPLOADS"; chmod 755 "$UPLOADS"
chmod 700 "$BACKUPS"

say "4/9 Archivos del panel"
cd "$HERE"
tar --exclude=./node_modules --exclude=./.env --exclude='./.env.*' --exclude=./uploads --exclude='./uploads-*' --exclude=./tests -cf - . | (cd "$APP" && tar -xf -)
cd "$APP"
npm ci --omit=dev --no-audit --no-fund
chown -R root:trpanel "$APP"; chmod -R o-rwx "$APP"; chmod 750 "$APP"

say "5/9 Base de datos y configuración (.env)"
if [ ! -f "$APP/.env" ]; then
  DBPASS=$(openssl rand -hex 24)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tr_panel') THEN CREATE ROLE tr_panel LOGIN PASSWORD '$DBPASS';
  ELSE ALTER ROLE tr_panel PASSWORD '$DBPASS'; END IF;
END \$\$;
SQL
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='tr_panel'" | grep -q 1 || sudo -u postgres createdb -O tr_panel tr_panel
  sed -e "s#CAMBIAR_CLAVE_DB#$DBPASS#" -e "s#^SECRET_KEY=.*#SECRET_KEY=$(openssl rand -hex 32)#" "$APP/.env.example" > "$APP/.env"
  echo "Se creó $APP/.env con claves aleatorias."
fi
chown root:trpanel "$APP/.env"; chmod 640 "$APP/.env"
sudo -u trpanel node --env-file="$APP/.env" "$APP/src/migrate.js"

say "6/9 Servicio (systemd)"
cp "$APP/deploy/tomasramirezdev-panel.service" /etc/systemd/system/$SVC.service
systemctl daemon-reload
systemctl enable $SVC >/dev/null
systemctl restart $SVC
sleep 2
curl -fsS http://127.0.0.1:3100/api/health >/dev/null || { journalctl -u $SVC -n 30 --no-pager; die "El panel no arrancó."; }
echo "Panel funcionando en 127.0.0.1:3100"

say "7/9 Sitio web"
if [ -d "$BUNDLE/sitio" ]; then
  cp -a "$BUNDLE/sitio/." "$SITE/"
  find "$SITE" -type d -exec chmod 755 {} +; find "$SITE" -type f -exec chmod 644 {} +
fi

say "8/9 nginx"
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /root/nginx-respaldos
cp -a /etc/nginx/sites-available/tomasramirezdev "/root/nginx-respaldos/tomasramirezdev.$STAMP" 2>/dev/null || true
cp "$APP/deploy/tomasramirezdev-common.conf" "$APP/deploy/tomasramirezdev-proxy.conf" /etc/nginx/snippets/
cp "$APP/deploy/nginx-tomasramirezdev.conf" /etc/nginx/sites-available/tomasramirezdev
ln -sf /etc/nginx/sites-available/tomasramirezdev /etc/nginx/sites-enabled/tomasramirezdev
if nginx -t 2>/dev/null; then
  systemctl reload nginx
else
  nginx -t || true
  cp "/root/nginx-respaldos/tomasramirezdev.$STAMP" /etc/nginx/sites-available/tomasramirezdev 2>/dev/null || true
  die "La configuración de nginx tiene un error; se restauró la anterior."
fi

say "9/9 Copias de seguridad diarias"
cp "$APP/deploy/backup.sh" /usr/local/bin/tomasramirezdev-backup; chmod 750 /usr/local/bin/tomasramirezdev-backup
echo "17 4 * * * root /usr/local/bin/tomasramirezdev-backup" > /etc/cron.d/tomasramirezdev-backup

ADMINS=$(sudo -u postgres psql -d tr_panel -tAc "SELECT count(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'admin'")
say "Listo."
if [ "$ADMINS" = "0" ]; then
  echo "Falta crear tu usuario administrador. Corré:"
  echo "  cd $APP && sudo -u trpanel node --env-file=.env scripts/create-admin.js"
fi
echo "Panel: https://tomasramirezdev.com/admin/"
