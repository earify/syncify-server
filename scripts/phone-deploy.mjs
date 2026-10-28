// Deploys the syncify server to the phone over ADB (Termux).
//
//   npm run deploy:phone
//
// Steps: local build -> git archive HEAD -> adb push -> extract in Termux home
// -> npm install (if lockfile changed) -> tsc build -> restart server -> health check.
// Deploys the COMMITTED state; commit your changes first.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PHONE_HOME = "/data/data/com.termux/files/home";
const APP_DIR = `${PHONE_HOME}/syncify-server`;
const DATA_DIR = `${PHONE_HOME}/eari-sync-data`;
const REMOTE_TGZ = "/sdcard/Download/syncify-server-deploy.tgz";

function adbPath() {
  if (process.env.ADB) return process.env.ADB;
  const candidates = [
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "platform-tools", "adb.exe"),
    join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk", "platform-tools", "adb.exe"),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return "adb";
}

const adb = adbPath();
const sh = (cmd, opts = {}) => {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    throw new Error(`command failed (${r.status}): ${cmd.join(" ")}\n${r.stderr || r.stdout || ""}`);
  }
  return (r.stdout || "").trim();
};
const phone = (script, timeout = 120000) =>
  execFileSync(adb, ["shell", `run-as com.termux sh -c "${script}"`], { encoding: "utf8", timeout }).trim();

// 1. device check
const devices = sh([adb, "devices"]);
if (!/device\s*$/m.test(devices) || /^List/.test(devices) === false) {
  console.error("no ADB device connected:\n" + devices);
  process.exit(1);
}
console.log("adb device connected");

// 2. local build (fail fast before touching the phone)
console.log("building locally...");
const build = spawnSync("npm", ["run", "build"], { encoding: "utf8", shell: true });
if (build.status !== 0) {
  throw new Error(`local build failed:\n${build.stderr || build.stdout || ""}`);
}
console.log("local build ok");

// 3. archive committed state
const tmp = mkdtempSync(join(tmpdir(), "syncify-deploy-"));
const tgz = join(tmp, "deploy.tgz");
sh(["git", "archive", "--format=tar.gz", "-o", tgz, "HEAD"]);
console.log("archived HEAD ->", tgz);

// 4. push + extract
sh([adb, "push", tgz, REMOTE_TGZ]);
phone(`mkdir -p ${APP_DIR}`);
phone(`tar -xzf ${REMOTE_TGZ} -C ${APP_DIR}`);
console.log("extracted on phone");

// 5. deps (skip when lockfile unchanged and node_modules present)
phone(
  `cd ${APP_DIR} && { cmp -s package-lock.json .deploy-lock 2>/dev/null && [ -d node_modules ]; } || ` +
    `{ npm install --omit=dev --no-audit --no-fund --loglevel=error && cp package-lock.json .deploy-lock; }`,
  600000,
);
console.log("deps ok");

// 6. build on phone
phone(
  `cd ${APP_DIR} && node node_modules/typescript/lib/tsc.js -p shared/tsconfig.json && node node_modules/typescript/lib/tsc.js -p server/tsconfig.json`,
  300000,
);
console.log("built on phone");

// 7. switchover (kills the old eari-sync server too - same cmdline pattern)
const pids = phone(
  `pkill -f "server/dist/main.js"; sleep 1; cd ${APP_DIR} && ` +
    `EARI_SYNC_DATA_DIR=${DATA_DIR} nohup node server/dist/main.js >> ${PHONE_HOME}/syncify-server.log 2>&1 & sleep 2; ` +
    `pgrep -f "server/dist/main.js"`,
  60000,
);
if (!pids) {
  console.error("server did not start; log tail:");
  console.log(phone(`tail -n 30 ${PHONE_HOME}/syncify-server.log 2>/dev/null || echo "(no log)"`));
  process.exit(1);
}
console.log("server running, pid:", pids.split(/\s+/).join(", "));

// 8. health check from PC (end to end)
await new Promise((r) => setTimeout(r, 3000));
try {
  const res = await fetch("https://sync.earify.net:8443/health", { signal: AbortSignal.timeout(15000) });
  const body = await res.text();
  console.log("health:", res.status, body);
  if (res.status !== 200) process.exit(1);
} catch (e) {
  console.error("health check failed:", e?.message ?? e);
  console.log("log tail:", phone(`tail -n 30 ${PHONE_HOME}/syncify-server.log 2>/dev/null`));
  process.exit(1);
}

rmSync(tmp, { recursive: true, force: true });
console.log("deploy complete");
