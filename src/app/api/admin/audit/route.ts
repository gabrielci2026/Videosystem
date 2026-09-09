import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "ADMIN") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const limitValue = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(limitValue) ? limitValue : 50, 1), 100);
  const events = await prisma.auditEvent.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { actor: { select: { displayName: true, email: true } } } });
  return NextResponse.json(events);
}
