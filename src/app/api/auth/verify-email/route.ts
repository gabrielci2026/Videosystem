import { NextResponse } from "next/server";
import { hashString } from "@/lib/security";
import { prisma } from "@/lib/prisma";
import { getAppUrl } from "@/lib/app-url";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const token = searchParams.get("token");
  const roomName = searchParams.get("room");
  if (!token) return NextResponse.redirect(`${getAppUrl()}/?emailVerified=error`);
  const verification = await prisma.emailVerification.findUnique({ where: { tokenHash: hashString(token) } });
  if (!verification || verification.usedAt || verification.expiresAt < new Date()) return NextResponse.redirect(`${getAppUrl()}/?emailVerified=error`);
  const consumed = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.emailVerification.updateMany({
      where: { id: verification.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return false;
    await transaction.user.update({ where: { id: verification.userId }, data: { emailVerifiedAt: new Date() } });
    return true;
  });
  if (!consumed) return NextResponse.redirect(`${getAppUrl()}/?emailVerified=error`);
  const roomQuery = roomName && /^[a-zA-Z0-9_-]{3,120}$/.test(roomName)
    ? `&room=${encodeURIComponent(roomName)}`
    : "";
  return NextResponse.redirect(`${getAppUrl()}/?emailVerified=success${roomQuery}`);
}
