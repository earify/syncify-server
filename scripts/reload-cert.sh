#!/data/data/com.termux/files/usr/bin/bash
# reload the syncify server (called by acme.sh --reloadcmd after cert renewal)
bash "$(dirname "$0")/restart.sh"
