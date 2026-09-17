import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function contentSecurityPolicy(isDevelopment: boolean, nonce?: string) {
  const configuredLivekitUrl = process.env.LIVEKIT_URL?.trim();
  let livekitOrigin = "";
  try {
    if (configuredLivekitUrl) {
      const livekitUrl = new URL(configuredLivekitUrl);
      livekitOrigin = livekitUrl.protocol + "//" + livekitUrl.host;
    }
  } catch {
    livekitOrigin = "";
  }
  const connectSources = ["'self'", livekitOrigin || (isDevelopment ? "ws:" : "wss:")].join(" ");
  return [
    "default-src 'self'",
    "script-src " + (isDevelopment ? "'self' 'unsafe-inline' 'unsafe-eval'" : `'self' 'nonce-${nonce}' 'strict-dynamic'`),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src " + connectSources,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function applySecurityHeaders(response: NextResponse, isDevelopment: boolean, nonce?: string) {
  const csp = contentSecurityPolicy(isDevelopment, nonce);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=()");
  if (!isDevelopment) response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return response;
}

export function middleware(request: NextRequest) {
  const isDevelopment = process.env.NODE_ENV !== "production";
  if (isDevelopment) return applySecurityHeaders(NextResponse.next(), true);
  const nonce = btoa(crypto.randomUUID());
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy(false, nonce));
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isHttps = request.nextUrl.protocol === "https:" || (process.env.TRUST_PROXY === "true" && forwardedProto === "https");
  if (isHttps) return applySecurityHeaders(next(), false, nonce);
  if (request.nextUrl.pathname.startsWith("/api/")) return applySecurityHeaders(NextResponse.json({ error: "HTTPS es obligatorio" }, { status: 426 }), false, nonce);
  const secureUrl = request.nextUrl.clone();
  secureUrl.protocol = "https:";
  return applySecurityHeaders(NextResponse.redirect(secureUrl, 308), false, nonce);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
