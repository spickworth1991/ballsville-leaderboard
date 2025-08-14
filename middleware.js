// middleware.js
import { NextResponse } from "next/server";

export const config = {
  matcher: ["/data/:path*"], // only run on /data/*
};

export function middleware(req) {
  const { nextUrl } = req;
  const rewrite = nextUrl.clone();
  // /data/foo -> /api/data/foo
  rewrite.pathname = rewrite.pathname.replace(/^\/data\//, "/api/data/");
  return NextResponse.rewrite(rewrite);
}
