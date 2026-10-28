#!/data/data/com.termux/files/usr/bin/bash
# restart the syncify server (absolute paths: safe under cron/acme environments)
H=/data/data/com.termux/files/home
pkill -f "server/dist/main.js" 2>/dev/null || true
sleep 1
cd "$H/syncify-server" || exit 1
EARI_SYNC_DATA_DIR="$H/eari-sync-data" nohup node server/dist/main.js < /dev/null >> "$H/syncify-server.log" 2>&1 &
echo "syncify server restarted (pid $!)"
