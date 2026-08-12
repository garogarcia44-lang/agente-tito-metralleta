// Sesión de MarketSnack — cookie mutable, sin reiniciar el servidor.
//
// Antes la cookie solo vivía en MARKETSNACK_COOKIE (.env.local), que Next.js lee
// una vez al arrancar: pegar una cookie nueva exigía reiniciar el servidor a mano.
// Ahora `scripts/refresh-marketsnack-cookie.mjs` (headless, vía launchd, ver ese
// archivo) inicia sesión solo y escribe la cookie fresca aquí — el servidor la lee
// en cada request, así que el refresco automático surte efecto de inmediato.
//
// MARKETSNACK_COOKIE en .env.local queda como respaldo/arranque manual: si todavía
// no hay data/marketsnack-session.json (primera vez, o el refresco automático no
// está configurado), se usa esa.

import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "marketsnack-session.json");

export interface MarketsnackSession {
  cookie: string;
  updatedAt: string;
  source: "auto" | "manual";
}

export async function loadMarketsnackCookie(): Promise<string | null> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<MarketsnackSession>;
    if (parsed.cookie && parsed.cookie.trim()) return parsed.cookie.trim();
  } catch {
    // sin archivo todavía (o corrupto) — cae al .env.local
  }
  const envCookie = process.env.MARKETSNACK_COOKIE;
  return envCookie && envCookie.trim() ? envCookie.trim() : null;
}

export async function saveMarketsnackCookie(
  cookieValue: string,
  source: MarketsnackSession["source"] = "auto",
): Promise<MarketsnackSession> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const payload: MarketsnackSession = {
    cookie: cookieValue,
    updatedAt: new Date().toISOString(),
    source,
  };
  await fs.writeFile(FILE, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
