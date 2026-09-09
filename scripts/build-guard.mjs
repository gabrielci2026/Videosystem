import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const lockPath = path.resolve(".next", "build.lock");
const devLockPath = path.resolve(".next", "dev-server.lock");
const port = Number(process.env.PORT || 3000);

function isPortOpen(portNumber) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: portNumber });
    const finish = (open) => { socket.destroy(); resolve(open); };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

if (await isPortOpen(port)) {
  console.error(`No se puede ejecutar el build mientras hay un servidor en el puerto ${port}. Detén primero npm run dev.`);
  process.exit(1);
}

if (fs.existsSync(devLockPath)) {
  console.error("No se puede ejecutar el build mientras existe un servidor Next.js de desarrollo activo.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(lockPath), { recursive: true });
if (fs.existsSync(lockPath)) {
  const previousPid = Number(fs.readFileSync(lockPath, "utf8").trim());
  let alive = false;
  if (Number.isInteger(previousPid) && previousPid > 0) {
    try { process.kill(previousPid, 0); alive = true; } catch { alive = false; }
  }
  if (alive) {
    console.error(`Ya hay otro build activo (PID ${previousPid}).`);
    process.exit(1);
  }
  fs.rmSync(lockPath, { force: true });
}
fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });

const releaseLock = () => {
  try { if (fs.readFileSync(lockPath, "utf8").trim() === String(process.pid)) fs.rmSync(lockPath, { force: true }); } catch {}
};
process.once("exit", releaseLock);
process.once("SIGINT", () => { releaseLock(); process.exit(130); });
process.once("SIGTERM", () => { releaseLock(); process.exit(143); });

const nextCli = path.resolve("node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextCli, "build"], { stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => { releaseLock(); process.exit(code ?? (signal ? 1 : 0)); });
child.on("error", (error) => { releaseLock(); console.error("No se pudo iniciar Next.js:", error.message); process.exit(1); });
