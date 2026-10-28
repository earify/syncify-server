// Deploys the syncify server to the phone over ADB (Termux).
//
//   npm run deploy:phone
//
// Steps: local build -> git archive HEAD -> adb push -> extract in Termux home
// -> npm install (if lockfile changed) -> tsc build -> restart server -> health check.
// Deploys the COMMITTED state; commit your changes first.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PHONE_HOME = "/data/data/com.termux/files/home";
const APP_DIR = `${PHONE_HOME}/syncify-server`;
const DATA_DIR = `${PHONE_HOME}/eari-sync-data`;

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
const PHONE_ENV = "export PATH=/data/data/com.termux/files/usr/bin:/system/bin;";
const phone = (script, timeout = 120000, input) =>
  execFileSync(adb, ["shell", `run-as com.termux sh -c "${PHONE_ENV} ${script}"`], {
    encoding: "utf8",
    timeout,
    input,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();

// 1. device check
const devices = sh([adb, "devices"]);
if (!/device\s*$/m.test(devices) || /^List/.test(devices) === false) {
  console.error("no ADB device connected:\n" + devices);
  process.exit(1);
}
console.log("adb device connected");

// 2. local build (fail fast before touching the phone)
console.log("building locally...");
const build = spawnSync("npm run build", { encoding: "utf8", shell: true });
if (build.status !== 0) {
  throw new Error(`local build failed:\n${build.stderr || build.stdout || ""}`);
}
console.log("local build ok");

// 3. archive committed state
const tmp = mkdtempSync(join(tmpdir(), "syncify-deploy-"));
const tgz = join(tmp, "deploy.tgz");
sh(["git", "archive", "--format=tar.gz", "-o", tgz, "HEAD"]);
console.log("archived HEAD ->", tgz);

// 4. transfer via base64 over adb stdin (no /sdcard permission needed)
const b64 = readFileSync(tgz).toString("base64");
phone(`base64 -d > ${APP_DIR}/deploy.tgz`, 120000, b64);
phone(`tar -xzf ${APP_DIR}/deploy.tgz -C ${APP_DIR}`);
phone(`rm -f ${APP_DIR}/deploy.tgz`);
console.log("extracted on phone");

// 5. deps (skip when lockfile unchanged and node_modules present)
phone(
  `cd ${APP_DIR} && { cmp -s package-lock.json .deploy-lock 2>/dev/null && [ -d node_modules ]; } || ` +
    `{ npm install --no-audit --no-fund --loglevel=error && cp package-lock.json .deploy-lock; }`,
  600000,
);
console.log("deps ok");

// 6. build on phone
phone(
  `cd ${APP_DIR} && node node_modules/typescript/lib/tsc.js -p shared/tsconfig.json && node node_modules/typescript/lib/tsc.js -p server/tsconfig.json`,
  300000,
);
console.log("built on phone");

// 7. switchover: kill old, start new, verify via ps
try {
  phone(`pkill -f ^node.*server/dist/main; sleep 1; echo killed`, 60000);
} catch {}
// start: adb session won't close while the nohup'd server lives, so tolerate
// the timeout and just require the "started" marker on stdout
const start = spawnSync(
  adb,
  [
    "shell",
    `run-as com.termux sh -c "${PHONE_ENV} cd ${APP_DIR} && EARI_SYNC_DATA_DIR=${DATA_DIR} nohup node server/dist/main.js < /dev/null >> ${PHONE_HOME}/syncify-server.log 2>&1 & echo started"`,
  ],
  { encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024 },
);
if (!/started/.test(start.stdout ?? "")) {
  console.error("server start failed:", (start.stderr || start.stdout || "").trim());
  process.exit(1);
}
console.log("start command issued");
await new Promise((r) => setTimeout(r, 2500));
const ps = phone(`ps -ef | grep dist/main.js | grep -v grep`, 60000);
if (!ps.includes("node")) {
  console.error("server not running; log tail:");
  try {
    console.log(phone(`tail -n 30 ${PHONE_HOME}/syncify-server.log 2>/dev/null`));
  } catch {}
  process.exit(1);
}
const pids = ps
  .split("\n")
  .map((l) => l.trim().split(/\s+/)[1])
  .filter(Boolean);
console.log("server running, pid:", pids.join(", "));

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
