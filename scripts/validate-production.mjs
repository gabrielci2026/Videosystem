import fs from "node:fs";
import { spawnSync } from "node:child_process";

const composePath = "docker-compose.production.yml";
const exampleEnv = ".env.production.example";
if (!fs.existsSync(composePath) || !fs.existsSync(exampleEnv)) {
  console.error("Faltan archivos de configuración de producción.");
  process.exit(1);
}

const compose = fs.readFileSync(composePath, "utf8");
for (const required of ["services:", "app:", "postgres:", "livekit:", "healthcheck:"]) {
  if (!compose.includes(required)) {
    console.error(`La configuración de producción no contiene: ${required}`);
    process.exit(1);
  }
}

const docker = spawnSync("docker", ["compose", "-f", composePath, "--env-file", exampleEnv, "config", "--quiet"], {
  encoding: "utf8",
  timeout: 30_000,
  env: { ...process.env, APP_ENV_FILE: exampleEnv },
});
if (docker.error?.code === "ENOENT") {
  console.log("Docker no está instalado; se validaron los archivos y servicios declarados.");
  process.exit(0);
}
if (docker.status !== 0) {
  console.error("Docker Compose rechazó la configuración:", docker.stderr || docker.error?.message || "error desconocido");
  process.exit(1);
}
console.log("Configuración Docker de producción válida.");
