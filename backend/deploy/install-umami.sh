#!/usr/bin/env bash
# Instala Umami (estadísticas) en estadisticas.tomasramirezdev.com, en el puerto interno 3200.
# Requisito: el subdominio ya tiene que apuntar al VPS (registro A "estadisticas").
# Uso (como root):  bash deploy/install-umami.sh
set -euo pipefail
DOMAIN=estadisticas.tomasramirezdev.com
DIR=/opt/umami
PORT=3200
say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || die "Correlo como root."

say "1/6 Herramientas"
command -v git >/dev/null || apt-get install -y git
corepack enable >/dev/null 2>&1 || npm install -g pnpm
command -v pnpm >/dev/null || npm install -g pnpm
id umami >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/umami --shell /usr/sbin/nologin umami

say "2/6 Base de datos"
if [ ! -f /var/lib/umami/db-url ]; then
  PASS=$(openssl rand -hex 24)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'umami') THEN CREATE ROLE umami LOGIN PASSWORD '$PASS';
  ELSE ALTER ROLE umami PASSWORD '$PASS'; END IF;
END \$\$;
SQL
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='umami'" | grep -q 1 || sudo -u postgres createdb -O umami umami
  echo "postgresql://umami:$PASS@127.0.0.1:5432/umami" > /var/lib/umami/db-url
  chmod 600 /var/lib/umami/db-url; chown umami:umami /var/lib/umami/db-url
fi
DB_URL=$(cat /var/lib/umami/db-url)

say "3/6 Descarga de la última versión estable"
TAG=$(git ls-remote --tags --refs https://github.com/umami-software/umami.git 'v*' | sed 's#.*/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
[ -n "$TAG" ] || die "No pude averiguar la última versión."
echo "Versión: $TAG"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin tag "$TAG" && git -C "$DIR" checkout -q "$TAG"
else
  git clone --depth 1 --branch "$TAG" https://github.com/umami-software/umami.git "$DIR"
fi
chown -R umami:umami "$DIR"

say "4/6 Instalación y compilación (tarda unos minutos)"
cat > "$DIR/.env" <<ENV
DATABASE_URL=$DB_URL
APP_SECRET=$(openssl rand -hex 32)
TWO_FACTOR_ENCRYPTION_KEY=$(openssl rand -hex 32)
DISABLE_TELEMETRY=1
ENV
[ -f /var/lib/umami/env-keep ] && cp /var/lib/umami/env-keep "$DIR/.env"
cp "$DIR/.env" /var/lib/umami/env-keep
chown umami:umami "$DIR/.env" /var/lib/umami/env-keep; chmod 600 "$DIR/.env" /var/lib/umami/env-keep
sudo -u umami -H bash -c "cd $DIR && pnpm install --frozen-lockfile && pnpm run build"

say "5/6 Servicio"
cat > /etc/systemd/system/umami.service <<UNIT
[Unit]
Description=Umami (estadísticas de tomasramirezdev.com)
After=network.target postgresql.service

[Service]
User=umami
WorkingDirectory=$DIR
Environment=PORT=$PORT
Environment=HOSTNAME=127.0.0.1
Environment=NODE_ENV=production
ExecStart=/usr/bin/env pnpm run start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now umami && systemctl restart umami
sleep 6
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" || { journalctl -u umami -n 40 --no-pager; die "Umami no arrancó."; }

say "6/6 nginx y certificado"
cat > /etc/nginx/sites-available/umami <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    server_tokens off;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGX
ln -sf /etc/nginx/sites-available/umami /etc/nginx/sites-enabled/umami
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" --redirect --agree-tos -m tomasramirezdev@hotmail.com --non-interactive
say "Listo: https://$DOMAIN  (usuario inicial: admin / umami — cambiala apenas entres)"
