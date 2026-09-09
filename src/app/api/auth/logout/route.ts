import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/request-security";
import { clearSession } from "@/lib/auth";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  await clearSession();
  return NextResponse.json({ message: "Sesión cerrada" });
}
