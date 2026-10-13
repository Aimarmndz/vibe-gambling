#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Escribe un fragmento de nginx que solo deja pasar a los rangos de Cloudflare
# (https://www.cloudflare.com/ips/) y deniega el resto. Es la alternativa al firewall de
# cloudflare-firewall.sh cuando la VPS sirve otras webs que NO van por Cloudflare y por eso
# 80/443 tienen que seguir abiertos a todo el mundo: el filtro se aplica solo a los sitios que
# incluyen el fragmento (vibe.aimar.dev), y así nadie puede saltarse Cloudflare para hablar con
# el servidor directamente y falsear CF-Connecting-IP.
#
#   sudo ./cloudflare-nginx.sh            # aplica (idempotente: vuelve a ejecutarlo para actualizar)
#   sudo ./cloudflare-nginx.sh --dry-run  # solo enseña el fragmento que escribiría
#
# Instálalo como root, fuera de la carpeta del despliegue, y ejecútalo cada semana con un timer
# de systemd (ver docs/DESPLIEGUE.md, «Desplegar con Noust»).
# NO se ejecuta en local: es para la VPS.
set -euo pipefail

IPS_V4_URL="${CLOUDFLARE_IPS_V4_URL:-https://www.cloudflare.com/ips-v4}"
IPS_V6_URL="${CLOUDFLARE_IPS_V6_URL:-https://www.cloudflare.com/ips-v6}"
SNIPPET="${CLOUDFLARE_NGINX_SNIPPET:-/etc/nginx/snippets/cloudflare-only.conf}"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

if ! ${DRY_RUN}; then
  command -v nginx >/dev/null || { echo "Necesita nginx" >&2; exit 1; }
  [[ ${EUID} -eq 0 ]] || { echo "Ejecútalo como root" >&2; exit 1; }
fi

ranges="$(curl -fsS --max-time 20 "${IPS_V4_URL}"; echo; curl -fsS --max-time 20 "${IPS_V6_URL}")"
mapfile -t cidrs < <(printf '%s\n' "${ranges}" | grep -E '^[0-9a-fA-F:.]+/[0-9]+$' || true)
# Si la descarga falla o viene vacía, no se toca nada (mejor rangos viejos que ninguno).
if (( ${#cidrs[@]} < 10 )); then
  echo "La lista de Cloudflare parece incompleta (${#cidrs[@]} rangos): no se cambia nada." >&2
  exit 1
fi

content="$(
  echo "# Generado por cloudflare-nginx.sh el $(date -u +%Y-%m-%dT%H:%M:%SZ). No lo edites a mano."
  echo "# Solo Cloudflare puede hablar con los sitios que incluyen este fragmento."
  for cidr in "${cidrs[@]}"; do echo "allow ${cidr};"; done
  echo "deny all;"
)"

if ${DRY_RUN}; then
  printf '%s\n' "${content}"
  exit 0
fi

install -d -m 0755 "$(dirname "${SNIPPET}")"
backup=""
if [[ -f "${SNIPPET}" ]]; then
  backup="$(mktemp)"
  cp -p "${SNIPPET}" "${backup}"
fi
tmp="$(mktemp "${SNIPPET}.XXXXXX")"
printf '%s\n' "${content}" >"${tmp}"
chmod 0644 "${tmp}"
mv -f "${tmp}" "${SNIPPET}"

# Solo se recarga nginx si la configuración entera sigue siendo válida; si no, se deja como estaba.
if nginx -t -q; then
  systemctl reload nginx
  echo "Fragmento con ${#cidrs[@]} rangos de Cloudflare en ${SNIPPET}; nginx recargado."
else
  if [[ -n "${backup}" ]]; then mv -f "${backup}" "${SNIPPET}"; else rm -f "${SNIPPET}"; fi
  echo "nginx -t ha fallado: se restaura el fragmento anterior y no se recarga nada." >&2
  exit 1
fi
[[ -n "${backup}" && -f "${backup}" ]] && rm -f "${backup}"
exit 0
