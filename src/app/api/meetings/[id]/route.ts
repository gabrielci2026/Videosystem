import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";

const input = z.object({ title: z.string().trim().min(2).max(120).optional(), scheduledAt: z.string().datetime().optional() });

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting || meeting.organizerId !== user.id) return NextResponse.json({ error: "Solo el organizador puede modificar la reunión" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success || (parsed.data.scheduledAt && new Date(parsed.data.scheduledAt).getTime() <= Date.now())) return NextResponse.json({ error: "Datos de reunión inválidos" }, { status: 400 });
  const updated = await prisma.meeting.update({ where: { id }, data: { ...parsed.data, scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined } });
  return NextResponse.json(updated);
}

export async function DELETE(request: Request, context: Context) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting || meeting.organizerId !== user.id) return NextResponse.json({ error: "Solo el organizador puede cancelar la reunión" }, { status: 403 });
  const cancelled = await prisma.meeting.update({ where: { id }, data: { status: "CANCELLED" } });
  return NextResponse.json(cancelled);
}
