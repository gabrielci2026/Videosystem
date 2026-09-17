import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashString, validatePasswordStrength } from "@/lib/security";
import { checkAddressRateLimit, checkRateLimit, getClientAddress } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";

const input = z.object({ token: z.string().min(32), password: z.string().min(8).max(128) });

export async function POST(request: Request) {
  const now = new Date();
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success || !validatePasswordStrength(parsed.data.password).isValid) return NextResponse.json({ error: "Token o contraseña inválidos" }, { status: 400 });
  const [addressRate, tokenRate] = await Promise.all([
    checkAddressRateLimit("reset-password-address", getClientAddress(request), 10, 15 * 60 * 1000),
    checkRateLimit("reset-password-token:" + hashString(parsed.data.token), 10, 15 * 60 * 1000),
  ]);
  if (!addressRate.allowed || !tokenRate.allowed) {
    const retryAfterSeconds = Math.max(addressRate.retryAfterSeconds, tokenRate.retryAfterSeconds);
    return NextResponse.json({ error: "Demasiados intentos. Espera " + retryAfterSeconds + " segundos." }, { status: 429 });
  }
  const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashString(parsed.data.token) } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) return NextResponse.json({ error: "Token inválido o expirado" }, { status: 400 });
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const consumed = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.passwordResetToken.updateMany({
      where: { id: reset.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return false;
    await transaction.user.update({ where: { id: reset.userId }, data: { passwordHash, passwordChangedAt: now } });
    await transaction.session.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: now } });
    await transaction.oTPRequest.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: now } });
    await transaction.passwordResetToken.updateMany({ where: { userId: reset.userId, id: { not: reset.id }, usedAt: null }, data: { usedAt: now } });
    return true;
  });
  if (!consumed) return NextResponse.json({ error: "Token invalido o expirado" }, { status: 400 });
  return NextResponse.json({ message: "Contraseña actualizada. Inicia sesión nuevamente." });
}
