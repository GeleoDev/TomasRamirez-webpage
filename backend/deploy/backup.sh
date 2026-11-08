#!/usr/bin/env bash
# Copia diaria de la base del panel y de las imágenes subidas. Guarda 14 días.
set -euo pipefail
DIR=/var/backups/tomasramirezdev
STAMP=$(date +%Y-%m-%d)
mkdir -p "$DIR"; chmod 700 "$DIR"
sudo -u postgres pg_dump -Fc tr_panel > "$DIR/panel-$STAMP.dump"
tar -czf "$DIR/imagenes-$STAMP.tar.gz" -C /var/www tomasramirezdev-uploads
find "$DIR" -type f -mtime +14 -delete
