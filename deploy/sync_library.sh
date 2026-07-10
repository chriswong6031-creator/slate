#!/usr/bin/env bash
# sync_library.sh — rsync processed library content to VPS
# Per deploy contract: no --delete (v1), ssh key macro_dashboard_deploy_v2

set -euo pipefail

LIBRARY_DIR="$HOME/SlateLibrary/library/"
REMOTE_HOST="root@146.190.142.17"
REMOTE_PATH="/opt/slate/library/"
SSH_KEY="$HOME/.ssh/macro_dashboard_deploy_v2"

rsync -az \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new" \
  "${LIBRARY_DIR}" \
  "${REMOTE_HOST}:${REMOTE_PATH}"
