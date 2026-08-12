// Login básico (usuario/contraseña) para toda la app. Pensado para cuando se expone
// por un túnel público (ej. cloudflared) — sin BASIC_AUTH_USER/PASSWORD configurados,
// no protege nada (para no bloquear el desarrollo local por accidente).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function unauthorized(): NextResponse {
  return new NextResponse("Autenticación requerida.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Tito Metralleta"' },
  });
}

export function proxy(request: NextRequest): NextResponse {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) return NextResponse.next();

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const [reqUser, reqPass] = atob(header.slice(6)).split(":");
    if (reqUser === user && reqPass === pass) return NextResponse.next();
  }

  return unauthorized();
}

export const config = {
  matcher: "/:path*",
};
