#!/bin/sh
# Backup diário do Postgres (FND-08.2): todo dia às 03:00 de São Paulo (06:00 UTC) e 5 min após subir.
# Guarda em /backups (pasta ./backups na VPS) e apaga os com mais de BACKUP_KEEP_DAYS dias.
set -u
KEEP="${BACKUP_KEEP_DAYS:-30}"

backup() {
  file="/backups/financeiro-$(date -u +%Y%m%d-%H%M).dump"
  if pg_dump -Fc -f "$file.tmp"; then
    mv "$file.tmp" "$file" && echo "backup ok: $file"
  else
    rm -f "$file.tmp"; echo "backup FALHOU" >&2
  fi
  find /backups -name 'financeiro-*.dump' -mtime +"$KEEP" -delete
}

sleep 300 # deixa a API aplicar as migrations antes do primeiro backup
backup
while true; do
  now=$(date -u +%s)
  next=$(( now / 86400 * 86400 + 6 * 3600 ))
  [ "$next" -le "$now" ] && next=$(( next + 86400 ))
  sleep $(( next - now ))
  backup
done
