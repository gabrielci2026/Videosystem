import fs from "node:fs";
import { spawnSync } from "node:child_process";

const composePath = "docker-compose.production.yml";
const exampleEnvPath = ".env.production.example";
const useExample = process.argv.includes("--example");
const envPath = process.env.APP_ENV_FILE || (useExample ? exampleEnvPath : ".env.production");

function parseEnv(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

if (!fs.existsSync(composePath)) {
  console.error("Falta docker-compose.production.yml.");
  process.exit(1);
}
if (!fs.existsSync(envPath)) {
  console.error("No existe el archivo de entorno de produccion: " + envPath);
  console.error("Crea .env.production o usa --example solo para validar la plantilla.");
  process.exit(1);
}

const values = parseEnv(fs.readFileSync(envPath, "utf8"));
const required = [
  "DATABASE_URL", "APP_URL", "NEXT_PUBLIC_APP_URL", "TRUST_PROXY",
  "LIVEKIT_URL", "LIVEKIT_ADMIN_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_NODE_IP",
  "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_REQUIRE_TLS", "SMTP_USER",
  "SMTP_PASS", "SMTP_FROM", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB",
];
for (const name of required) {
  if (!values[name]) {
    console.error("Falta la variable obligatoria " + name + " en " + envPath + ".");
    process.exit(1);
  }
}

const placeholder = /CHANGE_ME|PUBLIC_SERVER_IP|TAILSCALE_IP|video\.example\.com|smtp\.example\.com|noreply@example\.com|example\.com|replace[_-]?me/i;
if (!useExample) {
  for (const [name, value] of Object.entries(values)) {
    if (placeholder.test(value)) {
      console.error("La variable " + name + " todavia contiene un valor de ejemplo.");
      process.exit(1);
    }
  }
}

for (const name of ["APP_URL", "NEXT_PUBLIC_APP_URL"]) {
  try {
    if (new URL(values[name]).protocol !== "https:") throw new Error();
  } catch {
    console.error(name + " debe ser una URL HTTPS valida.");
    process.exit(1);
  }
}
try {
  if (new URL(values.LIVEKIT_URL).protocol !== "wss:") throw new Error();
} catch {
  console.error("LIVEKIT_URL debe ser una URL WSS valida.");
  process.exit(1);
}
for (const name of ["SMTP_SECURE", "SMTP_REQUIRE_TLS"]) {
  if (values[name].toLowerCase() !== "true") {
    console.error(name + " debe estar en true en produccion.");
    process.exit(1);
  }
}
if (values.TRUST_PROXY.toLowerCase() !== "true") {
  console.error("TRUST_PROXY debe ser true cuando la app esta detras de un proxy HTTPS.");
  process.exit(1);
}
if (["0.0.0.0", "::"].includes(values.PUBLISH_HOST?.trim())) {
  console.error("PUBLISH_HOST no puede ser una interfaz publica comodin; usa 127.0.0.1 con Tailscale Serve o la IP Tailscale con Caddy.");
  process.exit(1);
}
if (!useExample && !/^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(values.LIVEKIT_NODE_IP.trim())) {
  console.error("LIVEKIT_NODE_IP debe ser una IP IPv4 de Tailscale dentro del rango 100.64.0.0/10.");
  process.exit(1);
}
const meetingAccessWindowHours = Number(values.MEETING_ACCESS_WINDOW_HOURS ?? 24);
if (!Number.isFinite(meetingAccessWindowHours) || meetingAccessWindowHours <= 0 || meetingAccessWindowHours > 168) {
  console.error("MEETING_ACCESS_WINDOW_HOURS debe ser un numero mayor que 0 y menor o igual a 168.");
  process.exit(1);
}

const compose = fs.readFileSync(composePath, "utf8");
for (const requiredText of ["services:", "migrate:", "retention:", "app:", "postgres:", "livekit:", "healthcheck:"]) {
  if (!compose.includes(requiredText)) {
    console.error("La configuracion de produccion no contiene: " + requiredText);
    process.exit(1);
  }
}

const docker = spawnSync("docker", ["compose", "-f", composePath, "--env-file", envPath, "config", "--quiet"], {
  encoding: "utf8",
  timeout: 30_000,
  env: { ...process.env, APP_ENV_FILE: envPath },
});
if (docker.error?.code === "ENOENT") {
  console.log("Docker no esta instalado; se validaron las variables y servicios declarados.");
  process.exit(0);
}
if (docker.status !== 0) {
  console.error("Docker Compose rechazo la configuracion:", docker.stderr || docker.error?.message || "error desconocido");
  process.exit(1);
}
console.log("Configuracion de produccion valida: " + envPath);
