import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmailAfterResponse, sendMeetingInviteEmail } from "@/lib/email";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";
import { checkRateLimit, getClientAddress } from "@/lib/rate-limit";

const input = z.object({ roomName: z.string().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/), userIds: z.array(z.string().min(1)).min(1).max(50) });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const organizer = await getCurrentUser();
  if (!organizer || organizer.status !== "ACTIVE" || organizer.role === "GUEST") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Selecciona al menos un usuario" }, { status: 400 });
  const address = getClientAddress(request);
  const rate = await checkRateLimit(`invite-users:${organizer.id}:${address}`, 30, 60 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: `Demasiadas invitaciones. Espera ${rate.retryAfterSeconds} segundos.` }, { status: 429 });

  const users = await prisma.user.findMany({ where: { id: { in: parsed.data.userIds }, status: "ACTIVE", role: { not: "GUEST" }, NOT: { id: organizer.id } }, select: { email: true, displayName: true } });
  if (users.length !== new Set(parsed.data.userIds).size) return NextResponse.json({ error: "Solo puedes invitar cuentas activas" }, { status: 400 });
  const room = await prisma.callRoom.upsert({ where: { roomName: parsed.data.roomName }, update: {}, create: { roomName: parsed.data.roomName, ownerId: organizer.id } });
  if (room.ownerId !== organizer.id) return NextResponse.json({ error: "Solo el propietario puede invitar usuarios" }, { status: 403 });
  await prisma.callRoomMember.createMany({ data: parsed.data.userIds.map((userId) => ({ roomId: room.id, userId })), skipDuplicates: true });
  sendEmailAfterResponse("room-invites", async () => {
    const results = await Promise.all(users.map((user) => sendMeetingInviteEmail(user.email, user.displayName, organizer.displayName, `Invitación a ${parsed.data.roomName}`, new Date(), parsed.data.roomName)));
    return results.every(Boolean);
  });
  return NextResponse.json({ sentCount: users.length, emailQueued: true });
}
