#!/usr/bin/env bash
# Pull latest main and run Contabo cutover (run on VPS as root).
# Source: sokalive/nassani-admin ONLY — never Osmani.
#
# Contabo web console one-liner (after first clone/bootstrap):
#   curl -fsSL https://raw.githubusercontent.com/sokalive/nassani-admin/main/deploy/contabo/pull-and-apply.sh | bash
#
# Or:
#   cd /var/www/nassani-admin && bash deploy/contabo/pull-and-apply.sh
set -euo pipefail

ROOT="${NASSANI_ADMIN_ROOT:-/var/www/nassani-admin}"

if [[ ! -d "$ROOT/.git" ]]; then
  echo "ERROR: $ROOT is not a git repo. Bootstrap first:" >&2
  echo "  bash deploy/contabo/bootstrap-nassani-vps.sh" >&2
  echo "  # or: git clone https://github.com/sokalive/nassani-admin.git $ROOT" >&2
  exit 1
fi

ORIGIN="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
case "$ORIGIN" in
  *nassani-admin*) ;;
  *osmani*)
    echo "ERROR: refusing Osmani remote: $ORIGIN" >&2
    exit 1
    ;;
  *)
    echo "ERROR: origin must be sokalive/nassani-admin (got: $ORIGIN)" >&2
    exit 1
    ;;
esac

echo "==> git pull (hard reset to origin/main)"
cd "$ROOT"
git fetch origin main
git reset --hard origin/main
echo "    commit: $(git rev-parse HEAD)"
echo "    remote: $ORIGIN"

export NASSANI_ADMIN_ROOT="$ROOT"
export NASSANI_SKIP_NASSANITV_SSL="${NASSANI_SKIP_NASSANITV_SSL:-1}"
bash "$ROOT/deploy/contabo/apply-cutover.sh"

echo "==> Health"
curl -fsS "http://127.0.0.1:10001/api/health" || true
echo
