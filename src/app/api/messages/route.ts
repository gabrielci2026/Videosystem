import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";

const input = z.object({ recipientId: z.string().min(1), subject: z.string().min(1).max(160), body: z.string().min(1).max(10000) });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (user.role === "GUEST") return NextResponse.json({ error: "Los invitados no tienen acceso a mensajes" }, { status: 403 });
  const messages = await prisma.message.findMany({ where: { recipientId: user.id, expiresAt: { gt: new Date() }, status: { not: "DELETED" } }, orderBy: { createdAt: "desc" }, include: { sender: { select: { displayName: true, email: true } } } });
  return NextResponse.json(messages);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (user.role === "GUEST") return NextResponse.json({ error: "Los invitados no tienen acceso a mensajes" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const recipient = await prisma.user.findUnique({ where: { id: parsed.data.recipientId }, select: { status: true, role: true } });
  if (!recipient || recipient.status !== "ACTIVE" || recipient.role === "GUEST") return NextResponse.json({ error: "El destinatario no está disponible para mensajería" }, { status: 400 });
  const expiresAt = new Date(Date.now() + Number(process.env.MESSAGE_RETENTION_DAYS ?? 30) * 86400000);
  const message = await prisma.message.create({ data: { ...parsed.data, senderId: user.id, expiresAt } });
  return NextResponse.json(message, { status: 201 });
}
