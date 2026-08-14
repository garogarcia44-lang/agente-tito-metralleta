// Token de sesión firmado (HMAC-SHA256), sin base de datos ni estado en el
// servidor — se valida solo verificando la firma y la fecha de expiración.
// Reemplaza HTTP Basic Auth como mecanismo de login del navegador: ver
// proxy.ts para el porqué (EventSource no manda Basic Auth de forma confiable
// en móvil, una cookie sí, siempre).

import { createHmac, timingSafeEqual } from "crypto";

export const COOKIE_NAME = "tito_session";
export const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 días — uso personal, no hace falta reloguear seguido.

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("Falta SESSION_SECRET en .env.local.");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function createSessionToken(now: Date = new Date()): string {
  const expires = now.getTime() + MAX_AGE_MS;
  const payload = `v1:${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null, now: Date = new Date()): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);

  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return false;

  const [version, expiresStr] = payload.split(":");
  if (version !== "v1") return false;
  const expires = Number(expiresStr);
  return Number.isFinite(expires) && now.getTime() < expires;
}
