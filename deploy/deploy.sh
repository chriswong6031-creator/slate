#!/bin/bash
# Deploy Slate to the VPS (origin for slate.greydeercapital.com).
# Mirrors the greydeercapital deploy pattern: rsync the served app to /opt/slate.
# The Caddy site block lives in the MACRO repo (app/deploy/Caddyfile) — see deploy/README.md.
set -euo pipefail

VPS="${SLATE_VPS:-root@146.190.142.17}"
KEY="${SLATE_KEY:-$HOME/.ssh/macro_dashboard_deploy_v2}"
WEBROOT=/opt/slate
HERE="$(cd "$(dirname "$0")/.." && pwd)"
RSH="ssh -i $KEY -o BatchMode=yes"

echo "[1/3] build check (sw.js version stamp must match sources)"
python3 "$HERE/build_standalone.py" >/dev/null
if ! git -C "$HERE" diff --quiet -- sw.js Slate.html 2>/dev/null; then
  echo "ERROR: sw.js/Slate.html were stale — build_standalone.py changed them." >&2
  echo "Commit the refreshed files, then deploy again." >&2
  exit 1
fi

echo "[2/3] rsync app -> $VPS:$WEBROOT"
ssh -i "$KEY" -o BatchMode=yes "$VPS" "mkdir -p $WEBROOT"
rsync -az --delete -e "$RSH" \
  --include 'index.html' --include 'manifest.webmanifest' --include 'sw.js' \
  --include 'library.html' \
  --include 'css/***' --include 'js/***' --include 'icons/***' \
  --exclude '*' \
  "$HERE/" "$VPS:$WEBROOT/"

echo "[3/3] verify"
curl -s --max-time 20 -o /dev/null -w 'live: HTTP %{http_code}\n' https://slate.greydeercapital.com/ || echo "live check skipped (DNS not ready?)"
echo "✓ deployed → https://slate.greydeercapital.com/"
