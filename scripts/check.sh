#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
project_python="${CAMPUSDINE_PYTHON:-$project_root/.venv/bin/python}"
if [[ ! -x "$project_python" ]]; then
  printf 'Python environment missing: %s\nFollow docs/run-guide.md first.\n' "$project_python" >&2
  exit 1
fi
cd "$project_root/backend"
"$project_python" -m pytest -q
cd "$project_root/frontend"
npm run typecheck
npm run build
TEST_PYTHON="$project_python" npm run test:e2e
