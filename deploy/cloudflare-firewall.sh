#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Abre 80/443 SOLO a los rangos de Cloudflare (https://www.cloudflare.com/ips/) con ufw.
# El registro vps.aimar.dev publica la IP real de la VPS: sin esto, cualquiera podría saltarse
# Cloudflare y hablar con el reverse proxy directamente (y falsear CF-Connecting-IP).
#
#   sudo ./cloudflare-firewall.sh            # aplica (idempotente: vuelve a ejecutarlo para actualizar)
#   sudo ./cloudflare-firewall.sh --dry-run  # solo enseña lo que haría
#
# Instálalo como root y fuera de la carpeta del despliegue, para que el usuario de despliegue no pueda
# cambiar lo que ejecuta root (ver docs/DESPLIEGUE.md):
#   sudo install -o root -g root -m 0755 cloudflare-firewall.sh /usr/local/sbin/
# Cron semanal sugerido (root): 0 5 * * 1 /usr/local/sbin/cloudflare-firewall.sh
# ufw no filtra los puertos que publica Docker: si el reverse proxy corre en un contenedor,
# usa la cadena DOCKER-USER o el firewall del panel de IONOS.
# OJO: no cierra el SSH (22); restríngelo tú a tus IPs. NO se ejecuta en local: es para la VPS.
set -euo pipefail

IPS_V4_URL="${CLOUDFLARE_IPS_V4_URL:-https://www.cloudflare.com/ips-v4}"
IPS_V6_URL="${CLOUDFLARE_IPS_V6_URL:-https://www.cloudflare.com/ips-v6}"
PORTS=(80 443)
COMMENT="cloudflare"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

run() {
  if ${DRY_RUN}; then echo "+ $*"; else "$@"; fi
}

command -v ufw >/dev/null || { echo "Necesita ufw" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || ${DRY_RUN} || { echo "Ejecútalo como root" >&2; exit 1; }

ranges="$(curl -fsS --max-time 20 "${IPS_V4_URL}"; echo; curl -fsS --max-time 20 "${IPS_V6_URL}")"
mapfile -t cidrs < <(printf '%s\n' "${ranges}" | grep -E '^[0-9a-fA-F:.]+/[0-9]+$' || true)
# Si la descarga falla o viene vacía, no se toca nada (mejor reglas viejas que ninguna).
if (( ${#cidrs[@]} < 10 )); then
  echo "La lista de Cloudflare parece incompleta (${#cidrs[@]} rangos): no se cambia nada." >&2
  exit 1
fi

# Quita las reglas anteriores de este script (por comentario) y cualquier "allow 80/443" abierto.
mapfile -t old < <(ufw status numbered | grep -E "# ${COMMENT}\$" | sed -E 's/^\[ *([0-9]+)\].*/\1/' | sort -rn)
for n in "${old[@]}"; do run ufw --force delete "${n}"; done
for port in "${PORTS[@]}"; do
  run ufw --force delete allow "${port}/tcp" >/dev/null 2>&1 || true
done

for cidr in "${cidrs[@]}"; do
  for port in "${PORTS[@]}"; do
    run ufw allow proto tcp from "${cidr}" to any port "${port}" comment "${COMMENT}"
  done
done
run ufw reload
echo "80/443 abiertos solo a ${#cidrs[@]} rangos de Cloudflare."
