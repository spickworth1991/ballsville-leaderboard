import { NextResponse } from "next/server";

export const config = { matcher: ["/data/:path*"] };

export function middleware(req) {
  const u = req.nextUrl.clone();
  u.pathname = u.pathname.replace(/^\/data\//, "/api/data/");
  return NextResponse.rewrite(u);
}
