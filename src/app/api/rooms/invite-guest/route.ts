import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmailAfterResponse, sendGuestInviteEmail } from "@/lib/email";
import { guestInvitationExpiry, guestInvitationLink } from "@/lib/guest-invitations";
import { generateSecureToken, hashString } from "@/lib/security";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";

const input = z.object({
  roomName: z.string().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email(),
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const organizer = await getCurrentUser();
  if (!organizer || organizer.status !== "ACTIVE" || organizer.role === "GUEST") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Email o sala inválidos" }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  if (email === organizer.email || await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return NextResponse.json({ error: "Ese email ya tiene una cuenta. Invítalo desde la lista de usuarios." }, { status: 409 });
  }

  const meeting = await prisma.meeting.findUnique({ where: { roomName: parsed.data.roomName } });
  let title = `Invitación a ${parsed.data.roomName}`;
  let scheduledAt: Date | undefined;
  if (meeting) {
    if (meeting.organizerId !== organizer.id || meeting.status === "CANCELLED") {
      return NextResponse.json({ error: "Solo el organizador puede invitar personas" }, { status: 403 });
    }
    title = meeting.title;
    scheduledAt = meeting.scheduledAt;
  } else {
    const room = await prisma.callRoom.upsert({
      where: { roomName: parsed.data.roomName },
      update: {},
      create: { roomName: parsed.data.roomName, ownerId: organizer.id },
    });
    if (room.ownerId !== organizer.id) {
      return NextResponse.json({ error: "Solo el propietario puede invitar personas" }, { status: 403 });
    }
  }

  const token = generateSecureToken();
  const expiresAt = guestInvitationExpiry(scheduledAt);
  await prisma.$transaction([
    prisma.invitation.updateMany({
      where: { email, roomName: parsed.data.roomName, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    }),
    prisma.invitation.create({
      data: { email, roomName: parsed.data.roomName, invitedById: organizer.id, tokenHash: hashString(token), expiresAt },
    }),
    prisma.auditEvent.create({
      data: { actorId: organizer.id, action: "guest.invited", metadata: { email, roomName: parsed.data.roomName } },
    }),
  ]);

  const link = guestInvitationLink(token);
  sendEmailAfterResponse("guest-invite", () => sendGuestInviteEmail(email, organizer.displayName, title, scheduledAt, link, expiresAt));
  return NextResponse.json({ link, emailQueued: true, expiresAt }, { status: 201 });
}
