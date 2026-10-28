# syncify-server

Self-hosted Obsidian vault sync server. Runs anywhere Node 22.5+ runs — built
for **Termux (Android)** with zero native dependencies (`node:sqlite`, Fastify).

Pairs with the [syncify](https://github.com/earify/syncify) Obsidian plugin.
Wire-compatible with the eari-sync v1 protocol and data layout, so it can take
over an existing `~/eari-sync-data` directory as-is.

## Features

- Vault sync API: change log (per-vault monotonic seq), file upload/download,
  move, trash (30-day retention) + restore
- Conflict-safe pushes: stale `baseVersion` → `409`, identical content → idempotent no-op
- Live updates via WebSocket
- Share links with public reader pages (`/share/:id`, `/share/:id/raw`)
- scrypt-hashed vault secrets, rate limiting, path-traversal protection
- HTTPS via Let's Encrypt or self-signed certs (config file / env)

## Termux quick start

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/earify/syncify-server/master/scripts/install.sh)
```

or manually:

```bash
pkg install -y nodejs-lts git
cd ~ && git clone https://github.com/earify/syncify-server.git
cd syncify-server && npm install && npm run build
EARI_SYNC_DATA_DIR=~/eari-sync-data node server/dist/cli.js init --vault myvault
bash scripts/restart.sh
```

- Data dir defaults to `~/eari-sync-data` (config, SQLite DB, vault files)
- Restart any time: `bash ~/syncify-server/scripts/restart.sh`
- Logs: `~/syncify-server.log`

## Configuration

File `~/eari-sync-data/config/server.json` and/or env vars:

| Env | Meaning | Default |
|---|---|---|
| `EARI_SYNC_DATA_DIR` | data directory | `~/eari-sync-data` |
| `EARI_SYNC_PORT` | listen port | `8443` |
| `EARI_SYNC_HOST` | bind address | `0.0.0.0` |
| `EARI_SYNC_CERT` / `EARI_SYNC_KEY` | TLS cert/key paths | – (HTTP if unset) |
| `EARI_SYNC_CA` | CA cert served at `/ca.crt` | – |

## CLI

```bash
node server/dist/cli.js init --vault <id> --secret <secret>   # create/rotate vault
node server/dist/cli.js doctor                                # health check
node server/dist/cli.js backup                                # full data backup
```

## API (v1)

```
POST   /api/v1/auth/test
GET    /api/v1/vaults/:id/meta
GET    /api/v1/vaults/:id/changes?since=&limit=
GET    /api/v1/vaults/:id/files            (list live files)
GET    /api/v1/vaults/:id/files/*          (download)
PUT    /api/v1/vaults/:id/files/*          (upload, X-Base-Version for CAS)
DELETE /api/v1/vaults/:id/files/*
POST   /api/v1/vaults/:id/move
GET    /api/v1/vaults/:id/trash
POST   /api/v1/vaults/:id/trash/restore
GET    /api/v1/vaults/:id/ws?token=&cid=   (WebSocket)
POST   /api/v1/vaults/:id/shares           (+ GET / PATCH / DELETE)
GET    /share/:shareId[/raw]               (public)
GET    /health
```

Auth: `Authorization: Bearer <vault secret>` + `X-Vault-Id` / `X-Client-Id` headers.

## Development

```bash
npm install
npm run build
npm test        # vitest, 12 tests
npm start       # HTTP on 127.0.0.1:8443 (dev)
```

## License

MIT
