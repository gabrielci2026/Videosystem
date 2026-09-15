import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/request-security";
import { clearSession, getCurrentUser } from "@/lib/auth";
import { revokeLiveKitUserAccess } from "@/lib/livekit-admin";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const user = await getCurrentUser({ allowExpiredPassword: true });
  await clearSession();
  if (user) await revokeLiveKitUserAccess(user.id);
  return NextResponse.json({ message: "Sesión cerrada" });
}
