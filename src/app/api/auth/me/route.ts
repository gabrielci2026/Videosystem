import { NextResponse } from "next/server";
import { getCurrentUser, isPasswordChangeRequired } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser({ allowExpiredPassword: true });
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  return NextResponse.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    passwordChangeRequired: isPasswordChangeRequired(user.passwordChangedAt),
  });
}
