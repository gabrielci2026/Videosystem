import "dotenv/config";
import { execFileSync } from "node:child_process";

if (!process.env.BOOTSTRAP_ADMIN_EMAIL || !process.env.BOOTSTRAP_ADMIN_PASSWORD) {
  throw new Error("Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD before bootstrapping.");
}
execFileSync("npx", ["tsx", "prisma/seed.ts"], { stdio: "inherit", shell: true });
