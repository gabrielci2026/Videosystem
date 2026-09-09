import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validatePasswordStrength } from "@/lib/security";
import { sendEmailAfterResponse, sendWelcomeEmail } from "@/lib/email";
import { generateSecureToken, hashString } from "@/lib/security";
import { isSameOrigin } from "@/lib/request-security";
import { getAppUrl } from "@/lib/app-url";
import { readJsonBody } from "@/lib/request-body";

const input = z.object({ 
  email: z.string().email(), 
  displayName: z.string().min(2).max(80), 
  password: z.string().min(8).max(128),
  inviteToken: z.string().min(32).max(256).optional(),
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  
  const { email, displayName, password, inviteToken } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const invitation = inviteToken
    ? await prisma.invitation.findUnique({ where: { tokenHash: hashString(inviteToken) } })
    : null;
  if (inviteToken && (!invitation || !invitation.roomName)) {
    return NextResponse.json({ error: "La invitación no es válida" }, { status: 400 });
  }
  const guestRoomName = invitation?.roomName ?? undefined;
  if (invitation && guestRoomName) {
    if (invitation.acceptedAt) return NextResponse.json({ error: "La invitación ya fue utilizada" }, { status: 409 });
    if (invitation.expiresAt <= new Date()) return NextResponse.json({ error: "La invitación ha expirado" }, { status: 410 });
    if (invitation.email !== normalizedEmail) return NextResponse.json({ error: "Debes registrarte con el email que recibió la invitación" }, { status: 403 });
    const [meeting, room] = await Promise.all([
      prisma.meeting.findUnique({ where: { roomName: guestRoomName } }),
      prisma.callRoom.findUnique({ where: { roomName: guestRoomName } }),
    ]);
    if ((!meeting && !room) || meeting?.status === "CANCELLED") {
      return NextResponse.json({ error: "La llamada ya no está disponible" }, { status: 410 });
    }
  }
  
  // Validar fortaleza de contraseña
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.isValid) {
    return NextResponse.json({ 
      error: "Contraseña débil. Requisitos: " + passwordValidation.errors.join(", ") 
    }, { status: 400 });
  }
  
  if (await prisma.user.findUnique({ where: { email: normalizedEmail } })) {
    return NextResponse.json({ error: "La cuenta ya existe" }, { status: 409 });
  }

  const verificationToken = generateSecureToken();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.$transaction(async (transaction) => {
    const created = await transaction.user.create({
      data: {
        email: normalizedEmail,
        displayName,
        passwordHash,
        status: "PENDING",
        role: guestRoomName ? "GUEST" : "USER",
      },
    });

    if (invitation && guestRoomName) {
      const claimed = await transaction.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date(), acceptedById: created.id },
      });
      if (claimed.count !== 1) throw new Error("INVITATION_ALREADY_USED");

      const room = await transaction.callRoom.findUnique({ where: { roomName: guestRoomName } });
      const meeting = await transaction.meeting.findUnique({ where: { roomName: guestRoomName } });
      if (room) await transaction.callRoomMember.create({ data: { roomId: room.id, userId: created.id } });
      if (meeting) await transaction.meetingInvite.create({ data: { meetingId: meeting.id, userId: created.id } });
    }

    await transaction.emailVerification.create({
      data: { userId: created.id, tokenHash: hashString(verificationToken), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    return created;
  });

  const roomQuery = guestRoomName ? `&room=${encodeURIComponent(guestRoomName)}` : "";
  sendEmailAfterResponse("welcome", () => sendWelcomeEmail(normalizedEmail, displayName, `${getAppUrl()}/api/auth/verify-email?token=${verificationToken}${roomQuery}`));
  
  return NextResponse.json({ 
    id: user.id, 
    status: user.status,
    emailQueued: true,
    message: "Cuenta creada exitosamente. Revisa tu email para confirmar tu cuenta." 
  }, { status: 201 });
}

