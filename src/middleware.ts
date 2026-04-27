import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/api/refresh",
  "/api/odds/refresh",
  "/api/betting/settle",
  "/api/admin",
  "/api/calibration/run",
  "/api/research",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function hasValidBearer(req: NextRequest): boolean {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 && token === expected;
}

export function middleware(req: NextRequest) {
  if (!isProtected(req.nextUrl.pathname)) return NextResponse.next();
  if (isSameOrigin(req) || hasValidBearer(req)) return NextResponse.next();
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const config = {
  matcher: ["/api/:path*"],
};
