import { NextResponse } from "next/server";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";
import { isLiveKitParticipantConnected } from "@/lib/livekit-admin";

const input = z.object({ roomName: z.string().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/) });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Nombre de sala inválido. Usa solo letras, números, guiones o guiones bajos." }, { status: 400 });
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: "LiveKit no está configurado en el servidor. Reinicia pnpm dev después de revisar .env." }, { status: 503 });
  }
  if (process.env.NODE_ENV === "production" && !process.env.LIVEKIT_URL.startsWith("wss://")) {
    return NextResponse.json({ error: "LiveKit debe usar wss:// en produccion" }, { status: 503 });
  }
  const { roomName } = parsed.data;
  const guestInvitation = user.role === "GUEST"
    ? await prisma.invitation.findFirst({
        where: { acceptedById: user.id, roomName, acceptedAt: { not: null }, expiresAt: { gt: new Date() } },
        select: { id: true, expiresAt: true },
      })
    : null;
  const meeting = await prisma.meeting.findUnique({ where: { roomName }, include: { invites: { select: { userId: true } } } });
  if (meeting) {
    if (meeting.status === "CANCELLED") return NextResponse.json({ error: "Esta reunion ya no esta disponible" }, { status: 410 });
    if (meeting.scheduledAt > new Date()) return NextResponse.json({ error: "La reunion aun no ha comenzado" }, { status: 425 });
    const allowed = meeting.organizerId === user.id || meeting.invites.some((invite) => invite.userId === user.id);
    if (!allowed || (user.role === "GUEST" && !guestInvitation)) return NextResponse.json({ error: "No estás invitado a esta reunión" }, { status: 403 });
  } else {
    const room = await prisma.callRoom.findUnique({ where: { roomName }, include: { members: { select: { userId: true } } } });
    if (!room) {
      if (user.role === "GUEST") return NextResponse.json({ error: "No estás invitado a esta sala" }, { status: 403 });
      await prisma.callRoom.create({ data: { roomName, ownerId: user.id } });
    } else if ((room.ownerId !== user.id && !room.members.some((member) => member.userId === user.id)) || (user.role === "GUEST" && !guestInvitation)) {
      return NextResponse.json({ error: "No estás invitado a esta sala" }, { status: 403 });
    }
  }
  if (await isLiveKitParticipantConnected(roomName, user.id)) {
    return NextResponse.json({ error: "Ya tienes una conexion activa en esta sala" }, { status: 409 });
  }
  const roomOwner = meeting ? null : await prisma.callRoom.findUnique({ where: { roomName }, select: { ownerId: true } });
  const isCreator = meeting ? meeting.organizerId === user.id : roomOwner?.ownerId === user.id;
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: user.id,
    name: user.displayName,
    ttl: user.role === "GUEST" && guestInvitation
      ? Math.max(1, Math.floor((guestInvitation.expiresAt.getTime() - Date.now()) / 1000))
      : "10m",
  });
  const canPublishSources = user.role === "GUEST"
    ? [TrackSource.CAMERA, TrackSource.MICROPHONE]
    : [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE];
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishSources,
    canPublishData: user.role !== "GUEST",
  });
  return NextResponse.json({ token: await token.toJwt(), url: process.env.LIVEKIT_URL, isCreator, creatorId: meeting?.organizerId ?? roomOwner?.ownerId ?? null });
}

