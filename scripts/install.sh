#!/data/data/com.termux/files/usr/bin/bash
# one-shot Termux install/update for the syncify server
set -e
command -v node >/dev/null 2>&1 || pkg install -y nodejs-lts
command -v git >/dev/null 2>&1 || pkg install -y git
node -v
cd "$HOME"
[ -d syncify-server ] || git clone https://github.com/earify/syncify-server.git
cd syncify-server
git pull --ff-only || true
npm install --no-fund --no-audit
npm run build
if [ ! -d "$HOME/eari-sync-data/vaults" ]; then
  EARI_SYNC_DATA_DIR="$HOME/eari-sync-data" node server/dist/cli.js init
fi
bash scripts/restart.sh
echo
echo "done. verify with: curl -sk https://127.0.0.1:8443/health (or your public URL /health)"
