import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const lanIp = args[0] ?? detectLanIp();

if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "Usage: npm run cert:dev -- [LAN_IP]\nExample: npm run cert:dev -- 192.168.1.25",
  );
  process.exit(0);
}

if (!lanIp) {
  console.error(
    "Could not detect a LAN IPv4 address automatically. Run `npm run cert:dev -- <LAN_IP>`.",
  );
  process.exit(1);
}

if (!isIpv4Address(lanIp)) {
  console.error(`Invalid IPv4 address: ${lanIp}`);
  process.exit(1);
}

const certDir = resolve(process.cwd(), ".cert");
const keyPath = resolve(certDir, "dev-key.pem");
const certPath = resolve(certDir, "dev-cert.pem");

if (!existsSync(certDir)) {
  mkdirSync(certDir, { recursive: true });
}

const mkcertCheck = spawnSync("mkcert", ["-help"], {
  stdio: "ignore",
});

if (mkcertCheck.error || mkcertCheck.status !== 0) {
  console.error(
    "mkcert is not available in PATH. Install it first, then run `mkcert -install`.",
  );
  process.exit(1);
}

console.log("Generating local HTTPS certificate for Vite dev server...");
console.log(`Using LAN IP: ${lanIp}`);

const mkcertRun = spawnSync(
  "mkcert",
  [
    "-key-file",
    keyPath,
    "-cert-file",
    certPath,
    "localhost",
    "127.0.0.1",
    "::1",
    lanIp,
  ],
  {
    stdio: "inherit",
  },
);

if (mkcertRun.error || mkcertRun.status !== 0) {
  process.exit(mkcertRun.status ?? 1);
}

console.log("");
console.log("Certificate files ready:");
console.log(`- ${keyPath}`);
console.log(`- ${certPath}`);
console.log("");
console.log("Add these lines to .env if they are not there yet:");
console.log("VITE_DEV_HTTPS_KEY_PATH=.cert/dev-key.pem");
console.log("VITE_DEV_HTTPS_CERT_PATH=.cert/dev-cert.pem");
console.log("");
console.log("Then start the app with `npm run dev`.");

function isIpv4Address(value) {
  const parts = value.split(".");

  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d+$/.test(part)) {
        return false;
      }

      const number = Number(part);
      return number >= 0 && number <= 255;
    })
  );
}

function detectLanIp() {
  const interfaces = networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) {
      continue;
    }

    for (const address of addresses) {
      if (address.family !== "IPv4" || address.internal) {
        continue;
      }

      if (isPrivateIpv4Address(address.address)) {
        return address.address;
      }
    }
  }

  return undefined;
}

function isPrivateIpv4Address(value) {
  const [first, second] = value.split(".").map(Number);

  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}
