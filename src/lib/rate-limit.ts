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

export function getClientAddress(request: Request) {
  const requestWithIp = request as Request & { ip?: string };
  const frameworkIp = requestWithIp.ip?.trim();
  if (frameworkIp && /^[a-fA-F0-9:.]+$/.test(frameworkIp)) return frameworkIp;
  // Only trust the proxy-controlled header. Never accept the first X-Forwarded-For value,
  // which clients can prepend themselves when the proxy does not sanitize the chain.
  if (process.env.TRUST_PROXY === "true") {
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp && /^[a-fA-F0-9:.]+$/.test(realIp)) return realIp;
    return "trusted-proxy";
  }
  const fingerprint = [
    request.headers.get("user-agent") ?? "",
    request.headers.get("accept-language") ?? "",
    request.headers.get("sec-ch-ua") ?? "",
  ].join("|").slice(0, 256);
  if (fingerprint !== "||") return "fingerprint:" + hashString(fingerprint);
  return "direct";
}
