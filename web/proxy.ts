// Login para toda la app cuando se expone por un túnel público (cloudflared).
// Sin BASIC_AUTH_USER/PASSWORD configurados, no protege nada (no bloquea el
// desarrollo local por accidente) — igual que antes.
//
// Cookie de sesión para el navegador (lib/session.ts), no HTTP Basic Auth puro:
// EventSource (6 pantallas usan conexiones en vivo con esto) no manda de forma
// confiable las credenciales Basic Auth cacheadas por el navegador — verificado
// en vivo (Chrome iOS: la página cargaba, el EventSource nunca recibía nada).
// Una cookie sí se manda siempre, en cualquier tipo de request, sin excepción.
//
// Basic Auth se mantiene como segundo camino válido — no para el navegador,
// sino para los scripts propios (scan-auto.mjs, refresh-marketsnack-cookie.mjs)
// que ya lo usan y no tienen el problema de EventSource al no ser un navegador.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "./lib/session";

const PUBLIC_PATHS = ["/login", "/api/login"];

export function proxy(request: NextRequest): NextResponse {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (verifySessionToken(token)) return NextResponse.next();

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const [reqUser, reqPass] = atob(header.slice(6)).split(":");
    if (reqUser === user && reqPass === pass) return NextResponse.next();
  }

  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  if (acceptsHtml) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
}

export const config = {
  matcher: "/:path*",
};
