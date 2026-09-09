import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateOTP, hashString } from "@/lib/security";
import { sendOTPEmail } from "@/lib/email";
import { clearSession } from "@/lib/auth";
import { checkRateLimit, getClientAddress } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";

const input = z.object({ email: z.string().email(), password: z.string(), roomName: z.string().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/).optional() });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Credenciales inválidas" }, { status: 400 });

  // No se puede conservar una sesión anterior mientras se espera el segundo factor.
  await clearSession();
  
  const normalizedEmail = parsed.data.email.toLowerCase();
  const address = getClientAddress(request);
  const rate = await checkRateLimit(`login:${address}:${normalizedEmail}`, 5, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: `Demasiados intentos. Espera ${rate.retryAfterSeconds} segundos.` }, { status: 429 });
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }
  
  if (user.status !== "ACTIVE") {
    return NextResponse.json({ error: "La cuenta aún no está habilitada" }, { status: 403 });
  }
  if (!user.emailVerifiedAt) {
    return NextResponse.json({ error: "Confirma tu email antes de iniciar sesión" }, { status: 403 });
  }
  if (user.role === "GUEST") {
    if (!parsed.data.roomName) return NextResponse.json({ error: "Los invitados deben entrar desde su enlace de sala" }, { status: 403 });
    const room = await prisma.callRoom.findUnique({ where: { roomName: parsed.data.roomName }, include: { members: { select: { userId: true } } } });
    const meeting = await prisma.meeting.findUnique({ where: { roomName: parsed.data.roomName }, include: { invites: { select: { userId: true } } } });
    const allowed = Boolean(room?.members.some((member) => member.userId === user.id) || meeting?.invites.some((invite) => invite.userId === user.id));
    if (!allowed || meeting?.status === "CANCELLED") return NextResponse.json({ error: "No estás invitado a esta sala" }, { status: 403 });
  }
  
  // Generar OTP
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos
  
  // Guardar OTP en la base de datos
  await prisma.oTPRequest.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.oTPRequest.create({
    data: {
      userId: user.id,
      email: normalizedEmail,
      codeHash: hashString(otp),
      roomName: user.role === "GUEST" ? parsed.data.roomName : null,
      expiresAt,
    },
  });
  
  // Enviar OTP por email
  const emailSent = await sendOTPEmail(normalizedEmail, user.displayName, otp);
  
  // Solo en desarrollo: facilita probar el correo local con MailHog.
  if (process.env.NODE_ENV === "development") {
    console.error(`\n[VideoSystem] OTP PARA TESTING`);
    console.error(`Email: ${normalizedEmail}`);
    console.error(`Codigo OTP: ${otp}`);
    console.error(`Valido por: 10 minutos\n`);
  }
  
  if (!emailSent) {
    return NextResponse.json({ 
      error: "Error al enviar el código de verificación. Intenta nuevamente." 
    }, { status: 500 });
  }
  
  return NextResponse.json({ 
    message: "Se envió un código de verificación a tu email",
    userId: user.id,
    email: normalizedEmail,
    ...(process.env.NODE_ENV === "development" ? { developmentOtp: otp } : {}),
  }, { status: 200 });
}
