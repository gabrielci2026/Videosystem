import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (user.role === "GUEST") return NextResponse.json({ error: "Los invitados no tienen acceso a contactos" }, { status: 403 });
  return NextResponse.json(await prisma.user.findMany({ where: { status: "ACTIVE", role: { not: "GUEST" }, id: { not: user.id } }, select: { id: true, email: true, displayName: true, role: true } }));
}
