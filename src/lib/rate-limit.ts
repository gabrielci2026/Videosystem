import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashString } from "@/lib/security";

export async function checkRateLimit(key: string, limit: number, windowMs: number) {
  const resetAt = new Date(Date.now() + windowMs);
  const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>(Prisma.sql`
    INSERT INTO "RateLimitEntry" ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, ${resetAt}, NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitEntry"."resetAt" <= NOW() THEN 1 ELSE "RateLimitEntry"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitEntry"."resetAt" <= NOW() THEN ${resetAt} ELSE "RateLimitEntry"."resetAt" END,
      "updatedAt" = NOW()
    RETURNING "count", "resetAt"
  `);
  const current = rows[0];
  const now = Date.now();
  const retryAfterSeconds = Math.max(0, Math.ceil((current.resetAt.getTime() - now) / 1000));
  return { allowed: current.count <= limit, retryAfterSeconds: current.count > limit ? retryAfterSeconds : 0 };
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

const noClientRateLimit: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };

export function checkAddressRateLimit(prefix: string, address: string | null, limit: number, windowMs: number) {
  return address ? checkRateLimit(`${prefix}:${address}`, limit, windowMs) : Promise.resolve(noClientRateLimit);
}

export function getClientAddress(request: Request): string | null {
  const requestWithIp = request as Request & { ip?: string };
  const frameworkIp = requestWithIp.ip?.trim();
  if (frameworkIp && /^[a-fA-F0-9:.]+$/.test(frameworkIp)) return frameworkIp;
  // Only trust headers after the app is bound behind a trusted proxy. The last
  // X-Forwarded-For entry is the proxy's immediate client in the usual chain.
  if (process.env.TRUST_PROXY === "true") {
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp && /^[a-fA-F0-9:.]+$/.test(realIp)) return realIp;
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean);
    const forwardedIp = forwarded?.at(-1);
    if (forwardedIp && /^[a-fA-F0-9:.]+$/.test(forwardedIp)) return forwardedIp;
    // Never turn an unknown proxy address into one shared global bucket.
    return null;
  }
  const fingerprint = [
    request.headers.get("user-agent") ?? "",
    request.headers.get("accept-language") ?? "",
    request.headers.get("sec-ch-ua") ?? "",
  ].join("|").slice(0, 256);
  return fingerprint !== "||" ? "fingerprint:" + hashString(fingerprint) : null;
}
