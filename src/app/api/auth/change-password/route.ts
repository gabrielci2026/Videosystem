import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, getCurrentUser } from "@/lib/auth";
import { validatePasswordStrength } from "@/lib/security";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";

const input = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const user = await getCurrentUser({ allowExpiredPassword: true });
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const rate = await checkRateLimit(`password-change:${user.id}`, 5, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: `Demasiados intentos. Espera ${rate.retryAfterSeconds} segundos.` }, { status: 429 });

  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Datos de contraseña inválidos" }, { status: 400 });
  const { currentPassword, newPassword } = parsed.data;

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return NextResponse.json({ error: "La contraseña actual no es correcta" }, { status: 401 });
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    return NextResponse.json({ error: "La nueva contraseña debe ser diferente" }, { status: 400 });
  }
  const validation = validatePasswordStrength(newPassword);
  if (!validation.isValid) {
    return NextResponse.json({ error: "Contraseña débil. Requisitos: " + validation.errors.join(", ") }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } }),
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await createSession(user.id);

  return NextResponse.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    passwordChangeRequired: false,
    message: "Contraseña actualizada correctamente",
  });
}
