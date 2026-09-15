import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { generateSecureToken, hashString } from "@/lib/security";

const sessionCookie = "session";
const sessionLifetimeSeconds = 60 * 60 * 24 * 7;
export const passwordMaxAgeMs = 30 * 24 * 60 * 60 * 1000;

export function isPasswordChangeRequired(passwordChangedAt: Date) {
  return Date.now() - passwordChangedAt.getTime() >= passwordMaxAgeMs;
}

export async function createSession(userId: string) {
  const rawToken = generateSecureToken(32);
  await prisma.session.create({
    data: { tokenHash: hashString(rawToken), userId, expiresAt: new Date(Date.now() + sessionLifetimeSeconds * 1000) },
  });
  (await cookies()).set(sessionCookie, rawToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: sessionLifetimeSeconds });
}

export async function clearSession() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(sessionCookie)?.value;
  if (rawToken) await prisma.session.updateMany({ where: { tokenHash: hashString(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
  cookieStore.delete(sessionCookie);
}

export async function getCurrentUser(options: { allowExpiredPassword?: boolean } = {}) {
  const rawToken = (await cookies()).get(sessionCookie)?.value;
  if (!rawToken) return null;
  const session = await prisma.session.findFirst({ where: { tokenHash: hashString(rawToken), revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: true } });
  if (!session) return null;

  // Validate account state on every request so suspension is immediate even
  // when the browser still has a session cookie.
  if (session.user.status !== "ACTIVE") {
    await prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return null;
  }

  // Expired passwords may only reach the password-change endpoint. The
  // /api/auth/me route opts in so the UI can show the forced-change screen.
  if (!options.allowExpiredPassword && isPasswordChangeRequired(session.user.passwordChangedAt)) return null;

  return session.user;
}
