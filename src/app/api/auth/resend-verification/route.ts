import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateSecureToken, hashString } from "@/lib/security";
import { getAppUrl } from "@/lib/app-url";
import { sendEmailAfterResponse, sendWelcomeEmail } from "@/lib/email";
import { checkAddressRateLimit, checkRateLimit, getClientAddress } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request-security";
import { readJsonBody } from "@/lib/request-body";

const input = z.object({ email: z.string().email() });
const genericResponse = { message: "Si la cuenta puede verificarse, recibirás un nuevo enlace por email." };

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json(genericResponse);
  const email = parsed.data.email.toLowerCase();
  const address = getClientAddress(request);
  const [addressRate, emailRate] = await Promise.all([
    checkAddressRateLimit("verify-resend-address", address, 10, 15 * 60 * 1000),
    checkRateLimit("verify-resend:" + email, 3, 15 * 60 * 1000),
  ]);
  if (!addressRate.allowed || !emailRate.allowed) return NextResponse.json(genericResponse);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerifiedAt || !["PENDING", "INVITED"].includes(user.status)) return NextResponse.json(genericResponse);

  const token = generateSecureToken();
  await prisma.$transaction(async (transaction) => {
    await transaction.emailVerification.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await transaction.emailVerification.create({ data: { userId: user.id, tokenHash: hashString(token), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  });
  const invitation = user.role === "GUEST"
    ? await prisma.invitation.findFirst({ where: { acceptedById: user.id, roomName: { not: null } }, orderBy: { acceptedAt: "desc" }, select: { roomName: true } })
    : null;
  const roomQuery = invitation?.roomName ? `&room=${encodeURIComponent(invitation.roomName)}` : "";
  sendEmailAfterResponse("verification-resend", () => sendWelcomeEmail(email, user.displayName, `${getAppUrl()}/api/auth/verify-email?token=${token}${roomQuery}`));
  return NextResponse.json(genericResponse);
}
