import net from "node:net";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const portArgIndex = args.findIndex((value) => value === "-p" || value === "--port");
const port = Number(portArgIndex >= 0 ? args[portArgIndex + 1] : process.env.PORT || 3000);

function isPortOpen(portNumber) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: portNumber });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Puerto de desarrollo inválido.");
  process.exit(1);
}

if (await isPortOpen(port)) {
  console.error(`Ya hay un proceso escuchando en el puerto ${port}. Cierra el servidor Next existente o usa --port otro-puerto.`);
  process.exit(1);
}

const lockPath = path.resolve(".next", "dev-server.lock");
const buildLockPath = path.resolve(".next", "build.lock");
if (fs.existsSync(buildLockPath)) {
  console.error("Ya hay un build de Next.js en curso. Espera a que termine antes de iniciar desarrollo.");
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
    console.error(`Ya hay otro servidor de desarrollo activo (PID ${previousPid}).`);
    process.exit(1);
  }
  fs.rmSync(lockPath, { force: true });
}
fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });

const releaseLock = () => {
  try {
    if (fs.readFileSync(lockPath, "utf8").trim() === String(process.pid)) fs.rmSync(lockPath, { force: true });
  } catch {}
};
process.once("exit", releaseLock);
process.once("SIGINT", () => { releaseLock(); process.exit(130); });
process.once("SIGTERM", () => { releaseLock(); process.exit(143); });

const nextCli = path.resolve("node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextCli, "dev", ...args], { stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => { releaseLock(); process.exit(code ?? (signal ? 1 : 0)); });
child.on("error", (error) => {
  releaseLock();
  console.error("No se pudo iniciar Next.js:", error.message);
  process.exit(1);
});
