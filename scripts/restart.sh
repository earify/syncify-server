#!/data/data/com.termux/files/usr/bin/bash
# restart the syncify server (keeps existing eari-sync data dir)
pkill -f "server/dist/main.js" 2>/dev/null || true
sleep 1
cd "$HOME/syncify-server" || exit 1
EARI_SYNC_DATA_DIR="$HOME/eari-sync-data" nohup node server/dist/main.js > "$HOME/syncify-server.log" 2>&1 &
echo "syncify server restarted (pid $!)"
