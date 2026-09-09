import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateSecureToken, hashString } from "@/lib/security";
import { sendEmailAfterResponse, sendPasswordResetEmail } from "@/lib/email";
import { checkRateLimit, getClientAddress } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request-security";
import { getAppUrl } from "@/lib/app-url";
import { readJsonBody } from "@/lib/request-body";

const input = z.object({ email: z.string().email() });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ message: "Si la cuenta existe, recibirás instrucciones por email." });
  const email = parsed.data.email.toLowerCase();
  const address = getClientAddress(request);
  const rate = await checkRateLimit(`reset:${address}:${email}`, 3, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ message: "Si la cuenta existe, recibirás instrucciones por email." });
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.status === "ACTIVE") {
    const token = generateSecureToken();
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashString(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    sendEmailAfterResponse("password-reset", () => sendPasswordResetEmail(email, user.displayName, `${getAppUrl()}/?reset=${token}`));
  }
  return NextResponse.json({ message: "Si la cuenta existe, recibirás instrucciones por email." });
}
