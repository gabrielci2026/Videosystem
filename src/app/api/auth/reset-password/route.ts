import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashString, validatePasswordStrength } from "@/lib/security";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";

const input = z.object({ token: z.string().min(32), password: z.string().min(8).max(128) });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success || !validatePasswordStrength(parsed.data.password).isValid) return NextResponse.json({ error: "Token o contraseña inválidos" }, { status: 400 });
  const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashString(parsed.data.token) } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) return NextResponse.json({ error: "Token inválido o expirado" }, { status: 400 });
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
    prisma.session.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  return NextResponse.json({ message: "Contraseña actualizada. Inicia sesión nuevamente." });
}
