#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$root/.env"

if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file (copy .env.example and add Cloudflare credentials)." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

cd "$root"
exec "$@"
