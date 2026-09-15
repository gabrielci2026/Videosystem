import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";
import { revokeLiveKitParticipant } from "@/lib/livekit-admin";

const input = z.object({
  roomName: z.string().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/),
  userId: z.string().min(1),
});

async function authorizeRoomManager(roomName: string) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || user.role === "GUEST") return null;
  const meeting = await prisma.meeting.findUnique({ where: { roomName }, select: { id: true, organizerId: true, status: true } });
  if (meeting) {
    if (meeting.status === "CANCELLED" || meeting.organizerId !== user.id) return null;
    return { user, meeting, room: null };
  }
  const room = await prisma.callRoom.findUnique({ where: { roomName }, select: { id: true, ownerId: true } });
  if (!room || room.ownerId !== user.id) return null;
  return { user, meeting: null, room };
}

export async function GET(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const url = new URL(request.url);
  const roomName = url.searchParams.get("roomName") ?? "";
  if (!z.string().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/).safeParse(roomName).success) {
    return NextResponse.json({ error: "Sala inválida" }, { status: 400 });
  }
  const manager = await authorizeRoomManager(roomName);
  if (!manager) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const invitations = await prisma.invitation.findMany({
    where: { roomName, acceptedById: { not: null }, acceptedAt: { not: null }, expiresAt: { gt: new Date() } },
    select: { acceptedBy: { select: { id: true, email: true, displayName: true } }, expiresAt: true },
    orderBy: { acceptedAt: "asc" },
  });
  return NextResponse.json(invitations.flatMap((invitation) => invitation.acceptedBy ? [{ ...invitation.acceptedBy, expiresAt: invitation.expiresAt }] : []));
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const manager = await authorizeRoomManager(parsed.data.roomName);
  if (!manager) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const guest = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, role: true } });
  if (!guest || guest.role !== "GUEST") return NextResponse.json({ error: "Invitado no encontrado" }, { status: 404 });

  const now = new Date();
  const invitation = await prisma.invitation.findFirst({
    where: { roomName: parsed.data.roomName, acceptedById: guest.id, acceptedAt: { not: null } },
    select: { id: true },
  });
  if (!invitation) return NextResponse.json({ error: "El invitado no tiene acceso a esta sala" }, { status: 404 });

  await prisma.$transaction(async (transaction) => {
    await transaction.invitation.updateMany({ where: { roomName: parsed.data.roomName, acceptedById: guest.id }, data: { expiresAt: now } });
    if (manager.room) {
      await transaction.callRoomMember.deleteMany({ where: { roomId: manager.room.id, userId: guest.id } });
    }
    if (manager.meeting) {
      await transaction.meetingInvite.deleteMany({ where: { meetingId: manager.meeting.id, userId: guest.id } });
    }
    await transaction.auditEvent.create({
      data: { actorId: manager.user.id, action: "guest.revoked", metadata: { guestId: guest.id, roomName: parsed.data.roomName } },
    });
  });
  await revokeLiveKitParticipant(parsed.data.roomName, guest.id);
  return NextResponse.json({ revoked: true });
}