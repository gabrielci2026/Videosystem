import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { hashString } from "@/lib/security";
import { checkAddressRateLimit, checkRateLimit, getClientAddress } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";

const input = z.object({ 
  userId: z.string(), 
  code: z.string().length(8),
  roomName: z.string().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/).optional(),
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Código inválido" }, { status: 400 });
  }
  
  const { userId, code } = parsed.data;
  const address = getClientAddress(request);
  const [addressRate, userRate] = await Promise.all([
    checkAddressRateLimit("otp-address", address, 20, 10 * 60 * 1000),
    checkRateLimit("otp:" + userId, 5, 10 * 60 * 1000),
  ]);
  if (!addressRate.allowed || !userRate.allowed) {
    const retryAfterSeconds = Math.max(addressRate.retryAfterSeconds, userRate.retryAfterSeconds);
    return NextResponse.json({ error: "Demasiados intentos. Espera " + retryAfterSeconds + " segundos." }, { status: 429 });
  }
  
  // Buscar el OTP
  const normalizedCode = code.toUpperCase();
  const now = new Date();
  const otpRequest = await prisma.oTPRequest.findFirst({
    where: { userId, codeHash: hashString(normalizedCode), usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  
  if (!otpRequest) {
    return NextResponse.json({ error: "Código inválido" }, { status: 401 });
  }
  
  // Verificar que pertenece al usuario correcto
  if (otpRequest.userId !== userId) {
    return NextResponse.json({ error: "Código inválido para este usuario" }, { status: 401 });
  }
  if (otpRequest.roomName && otpRequest.roomName !== parsed.data.roomName) return NextResponse.json({ error: "Debes usar el enlace de la sala original" }, { status: 403 });
  
  // Verificar que no ha expirado
  if (new Date() > otpRequest.expiresAt) {
    return NextResponse.json({ error: "Código expirado" }, { status: 401 });
  }
  
  // Verificar que no ha sido usado
  if (otpRequest.usedAt) {
    return NextResponse.json({ error: "Código ya fue utilizado" }, { status: 401 });
  }
  
  // Obtener el usuario
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  if (user.status !== "ACTIVE" || !user.emailVerifiedAt) {
    return NextResponse.json({ error: "La cuenta no está habilitada" }, { status: 403 });
  }
  
  // El primer consumo gana; las solicitudes simultáneas no pueden reutilizarlo.
  const consumed = await prisma.oTPRequest.updateMany({
    where: { id: otpRequest.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) return NextResponse.json({ error: "Código ya fue utilizado" }, { status: 401 });
  
  // Crear sesión
  await createSession(user.id);
  
  return NextResponse.json({
    id: user.id,
    displayName: user.displayName,
    role: user.role,
    message: "Inicio de sesión exitoso",
  }, { status: 200 });
}
