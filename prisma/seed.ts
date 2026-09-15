import { PrismaClient, Role, UserStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const isProduction = process.env.NODE_ENV === "production"
    || process.env.APP_ENV === "production"
    || process.env.APP_URL?.startsWith("https://");
  if (isProduction) {
    throw new Error("El seed de desarrollo esta deshabilitado en produccion.");
  }
  const users = [
    { email: process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@videosystem.local", password: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "AdminVideo2026!", displayName: "Administrador", role: Role.ADMIN, status: UserStatus.ACTIVE },
    { email: "usuario1@videosystem.local", password: "UsuarioUno2026!", displayName: "Usuario de prueba 1", role: Role.USER, status: UserStatus.ACTIVE },
    { email: "usuario2@videosystem.local", password: "UsuarioDos2026!", displayName: "Usuario de prueba 2", role: Role.USER, status: UserStatus.ACTIVE },
  ];
  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { role: user.role, status: user.status, displayName: user.displayName, passwordHash: await bcrypt.hash(user.password, 12), passwordChangedAt: new Date(), emailVerifiedAt: new Date() },
      create: { email: user.email, displayName: user.displayName, passwordHash: await bcrypt.hash(user.password, 12), role: user.role, status: user.status, emailVerifiedAt: new Date() },
    });
    console.log(`Usuario listo: ${user.email}`);
  }
}

main().finally(() => prisma.$disconnect());
