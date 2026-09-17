import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-body";
import { isSameOrigin } from "@/lib/request-security";
import { getMeetingAccessState } from "@/lib/meeting-access";

const input = z.object({ roomName: z.string().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/), body: z.string().trim().min(1).max(2000) });

async function canAccessRoom(roomName: string, userId: string) {
  const meeting = await prisma.meeting.findUnique({ where: { roomName }, include: { invites: { select: { userId: true } } } });
  if (meeting) return meeting.status === "SCHEDULED" && getMeetingAccessState(meeting.scheduledAt) === "OPEN" && (meeting.organizerId === userId || meeting.invites.some((invite) => invite.userId === userId));
  const room = await prisma.callRoom.findUnique({ where: { roomName }, include: { members: { select: { userId: true } } } });
  return Boolean(room && (room.ownerId === userId || room.members.some((member) => member.userId === userId)));
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  const roomName = new URL(request.url).searchParams.get("roomName") ?? "";
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if ((user.role as string) === "GUEST") return NextResponse.json({ error: "Los invitados no tienen acceso al chat" }, { status: 403 });
  if (!(await canAccessRoom(roomName, user.id))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const messages = await prisma.callMessage.findMany({ where: { roomName, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "asc" }, take: 200, include: { sender: { select: { displayName: true } } } });
  return NextResponse.json(messages.map((message) => ({ id: message.id, from: message.senderId === user.id ? "Tú" : message.sender.displayName, text: message.body, createdAt: message.createdAt })));
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if ((user.role as string) === "GUEST") return NextResponse.json({ error: "Los invitados no tienen acceso al chat" }, { status: 403 });
  const rate = await checkRateLimit(`room-message:${user.id}`, 120, 60 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Demasiados mensajes. Intenta nuevamente mas tarde." }, { status: 429 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success || !(await canAccessRoom(parsed.data.roomName, user.id))) return NextResponse.json({ error: "Datos inválidos o sala no autorizada" }, { status: 403 });
  const message = await prisma.callMessage.create({ data: { roomName: parsed.data.roomName, senderId: user.id, body: parsed.data.body, expiresAt: new Date(Date.now() + Number(process.env.MESSAGE_RETENTION_DAYS ?? 30) * 86400000) }, include: { sender: { select: { displayName: true } } } });
  return NextResponse.json({ id: message.id, from: "Tú", text: message.body, createdAt: message.createdAt }, { status: 201 });
}

