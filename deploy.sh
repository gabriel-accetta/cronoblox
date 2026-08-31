#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=/home/ubuntu/opt/cronoblox
PNPM=/home/ubuntu/.nvm/versions/node/v24.16.0/bin/pnpm
export PATH=/home/ubuntu/.local/bin:/home/ubuntu/.nvm/versions/node/v24.16.0/bin:/home/ubuntu/.venv/bin:/usr/local/bin:/usr/bin:/bin

cd "$REPO_DIR"
git fetch origin && git reset --hard origin/main
"$PNPM" install --frozen-lockfile
"$PNPM" db:migrate
"$PNPM" build
sudo systemctl restart cronoblox-web cronoblox-worker
