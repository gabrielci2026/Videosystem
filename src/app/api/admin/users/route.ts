import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/request-security";
import { sendEmailAfterResponse, sendGuestApprovedEmail } from "@/lib/email";
import { readJsonBody } from "@/lib/request-body";
import { revokeLiveKitUserAccess } from "@/lib/livekit-admin";

const input = z.object({ userId: z.string().min(1), action: z.enum(["approve", "suspend"]) });

export async function GET() {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "ADMIN") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  return NextResponse.json(await prisma.user.findMany({ where: { status: { in: ["PENDING", "INVITED"] } }, select: { id: true, email: true, displayName: true, status: true, role: true, createdAt: true }, orderBy: { createdAt: "asc" } }));
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "ADMIN") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const status = parsed.data.action === "approve" ? "ACTIVE" : "SUSPENDED";
  const target = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, role: true, email: true, displayName: true } });
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  if (target.id === admin.id || target.role === "ADMIN") return NextResponse.json({ error: "No se puede modificar una cuenta administrativa" }, { status: 403 });
  const user = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.user.update({ where: { id: target.id }, data: { status } });
    if (parsed.data.action === "suspend") {
      await transaction.session.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await transaction.oTPRequest.updateMany({
        where: { userId: target.id, usedAt: null },
        data: { usedAt: new Date() },
      });
    }
    await transaction.auditEvent.create({ data: { actorId: admin.id, action: `user.${parsed.data.action}`, metadata: { userId: updated.id } } });
    return updated;
  });
  if (parsed.data.action === "suspend") {
    await revokeLiveKitUserAccess(target.id);
  }
  if (parsed.data.action === "approve" && target.role === "GUEST") {
    const invitation = await prisma.invitation.findFirst({
      where: { acceptedById: target.id, roomName: { not: null } },
      orderBy: { acceptedAt: "desc" },
      select: { roomName: true },
    });
    if (invitation?.roomName) sendEmailAfterResponse("guest-approved", () => sendGuestApprovedEmail(target.email, target.displayName, invitation.roomName!));
  }
  return NextResponse.json({ id: user.id, status: user.status });
}

