// POST /api/login — valida usuario/contraseña contra BASIC_AUTH_USER/PASSWORD
// y, si son correctos, pone la cookie de sesión. Ver proxy.ts para el porqué
// de reemplazar el prompt nativo de Basic Auth por esto.

import { NextResponse } from "next/server";
import { createSessionToken, COOKIE_NAME, MAX_AGE_MS } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) {
    return NextResponse.json({ error: "Login no configurado." }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  if (body.user !== user || body.password !== pass) {
    return NextResponse.json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  // Secure solo si de verdad llega por HTTPS (el túnel lo pone; localhost no) —
  // marcarlo siempre haría que la cookie no se guarde nunca en desarrollo local.
  const isHttps = request.headers.get("x-forwarded-proto") === "https";
  res.cookies.set(COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(MAX_AGE_MS / 1000),
  });
  return res;
}
