import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
  if (process.env.TRUST_PROXY !== "true") return "direct";
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
