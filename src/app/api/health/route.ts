import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", service: "videosystem", dependencies: { postgres: "ok", livekit: process.env.LIVEKIT_URL ? "configured" : "missing" }, timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "degraded", service: "videosystem", dependencies: { postgres: "error", livekit: process.env.LIVEKIT_URL ? "configured" : "missing" }, timestamp: new Date().toISOString() }, { status: 503 });
  }
}
