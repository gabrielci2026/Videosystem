import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";
import { setLiveKitParticipantMuted } from "@/lib/livekit-admin";

const input = z.object({ roomName: z.string().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/), userId: z.string().min(1), muted: z.boolean() });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const moderator = await getCurrentUser();
  if (!moderator || moderator.status !== "ACTIVE" || moderator.role === "GUEST") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success || parsed.data.userId === moderator.id) return NextResponse.json({ error: "Moderación inválida" }, { status: 400 });
  const { roomName, userId, muted } = parsed.data;

  const meeting = await prisma.meeting.findUnique({ where: { roomName }, select: { id: true, organizerId: true, status: true, invites: { select: { userId: true } } } });
  if (meeting) {
    if (meeting.status === "CANCELLED" || meeting.organizerId !== moderator.id) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    if (!meeting.invites.some((invite) => invite.userId === userId)) return NextResponse.json({ error: "Participante no autorizado" }, { status: 403 });
  } else {
    const room = await prisma.callRoom.findUnique({ where: { roomName }, select: { ownerId: true, members: { select: { userId: true } } } });
    if (!room || room.ownerId !== moderator.id) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    if (!room.members.some((member) => member.userId === userId)) return NextResponse.json({ error: "Participante no autorizado" }, { status: 403 });
  }

  const applied = await setLiveKitParticipantMuted(roomName, userId, muted);
  if (!applied) return NextResponse.json({ error: "El participante no tiene un micrófono activo en esta sala" }, { status: 409 });
  await prisma.auditEvent.create({ data: { actorId: moderator.id, action: muted ? "room.microphone_muted" : "room.microphone_unmuted", metadata: { roomName, userId } } });
  return NextResponse.json({ muted, userId });
}
