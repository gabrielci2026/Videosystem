import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashString } from "@/lib/security";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";

const tokenSchema = z.string().min(32).max(256);

async function resolve(token: string | null) {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return NextResponse.json({ error: "Invitación inválida" }, { status: 400 });

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashString(parsed.data) },
    include: { invitedBy: { select: { displayName: true } } },
  });
  if (!invitation || !invitation.roomName) return NextResponse.json({ error: "Invitación inválida" }, { status: 404 });
  if (invitation.expiresAt <= new Date()) return NextResponse.json({ error: "La invitación ha expirado" }, { status: 410 });

  const [meeting, room] = await Promise.all([
    prisma.meeting.findUnique({ where: { roomName: invitation.roomName }, select: { title: true, status: true } }),
    prisma.callRoom.findUnique({ where: { roomName: invitation.roomName }, select: { id: true } }),
  ]);
  if ((!meeting && !room) || meeting?.status === "CANCELLED") {
    return NextResponse.json({ error: "La llamada ya no está disponible" }, { status: 410 });
  }

  return NextResponse.json({
    email: invitation.email,
    roomName: invitation.roomName,
    organizerName: invitation.invitedBy.displayName,
    title: meeting?.title ?? `Llamada ${invitation.roomName}`,
    accepted: Boolean(invitation.acceptedAt),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const body = await readJsonBody(request);
  const token = body && typeof body === "object" && "token" in body ? String(body.token) : null;
  return resolve(token);
}

// Kept temporarily so invitations generated before the fragment migration do
// not break. New links never put their token in this URL.
export async function GET(request: Request) {
  return resolve(new URL(request.url).searchParams.get("token"));
}
