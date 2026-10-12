#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copia de seguridad diaria de Postgres (pg_dump en formato custom) con rotación.
#
#   ./backup.sh                 # vuelca a $BACKUP_DIR y borra los de más de $BACKUP_KEEP_DAYS días
#   ./backup.sh restore <file>  # restaura un volcado (¡sobrescribe la base de datos!)
#
# Lee POSTGRES_USER, POSTGRES_DB, BACKUP_DIR y BACKUP_KEEP_DAYS del .env de esta carpeta.
# Cron sugerido (usuario de despliegue, en el grupo docker):
#   15 4 * * * cd /srv/vibe-gambling && ./backup.sh >> /var/log/vibe-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  echo "Falta .env en $(pwd)" >&2
  exit 1
fi
read_env() {
  local value
  value="$(grep -E "^$1=" .env | tail -n1 | cut -d= -f2-)"
  if [[ -z "${value}" ]]; then
    echo "Falta $1 en .env" >&2
    exit 1
  fi
  printf '%s' "${value}"
}
PG_USER="$(read_env POSTGRES_USER)"
PG_DB="$(read_env POSTGRES_DB)"
DIR="$(read_env BACKUP_DIR)"
KEEP="$(read_env BACKUP_KEEP_DAYS)"
compose=(docker compose -f docker-compose.yml)

if [[ "${1:-}" == "restore" ]]; then
  file="${2:?Uso: ./backup.sh restore <archivo.dump>}"
  [[ -f "${file}" ]] || { echo "No existe ${file}" >&2; exit 1; }
  echo "Parando el servidor y restaurando ${file} en ${PG_DB}…"
  "${compose[@]}" stop server
  "${compose[@]}" exec -T postgres pg_restore -U "${PG_USER}" -d "${PG_DB}" \
    --clean --if-exists --no-owner --single-transaction < "${file}"
  "${compose[@]}" start server
  echo "Restaurado."
  exit 0
fi

mkdir -p "${DIR}"
chmod 700 "${DIR}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${DIR}/vibe-${stamp}.dump"
tmp="${target}.partial"
"${compose[@]}" exec -T postgres pg_dump -U "${PG_USER}" -d "${PG_DB}" --format=custom --compress=9 > "${tmp}"
mv "${tmp}" "${target}"
chmod 600 "${target}"
find "${DIR}" -maxdepth 1 -name 'vibe-*.dump' -type f -mtime "+${KEEP}" -delete
echo "Copia hecha: ${target} ($(du -h "${target}" | cut -f1))"
