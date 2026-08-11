// Estimador del próximo reporte de resultados.
//
// MarketSnack da `earnings_date` directo en /api/assets/{TICKER}, pero no
// siempre está poblado (queda null hasta acercarse la fecha real). Cuando
// falta, se cae a un proxy por cadencia (~91 días entre reportes) usando las
// fechas de reporte pasadas — hoy sin una fuente de histórico de filings, así
// que ese proxy queda sin datos reales y el flag efectivo es "no_aplica"
// hasta que MarketSnack publique la fecha. La UI declara que es estimación.
// El segundo proxy (skew del frente, >+10 pts = evento inminente) sigue igual.
//
// La parte pura (estimateNextEarnings, earningsFlag) no toca red.

import type { EarningsFlag } from "./wheel";

const QUARTER_DAYS = 91;
const DAY = 24 * 60 * 60 * 1000;

function toDay(d: string | number): string {
  return new Date(typeof d === "number" ? d : `${d}T00:00:00Z`).toISOString().slice(0, 10);
}

/**
 * Estima la fecha del próximo reporte a partir de los filing_date pasados.
 * Toma el más reciente y avanza en saltos de ~91 días hasta pasar HOY.
 */
export function estimateNextEarnings(filingDates: string[], now: Date): string | null {
  const times = filingDates
    .map((d) => new Date(`${d}T00:00:00Z`).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length === 0) return null;

  let next = times[times.length - 1];
  const nowT = now.getTime();
  while (next <= nowT) next += QUARTER_DAYS * DAY;
  return toDay(next);
}

export function earningsFlag(input: {
  nextEarnings: string | null;
  expiration: string;
  /** Skew del frente en puntos, de ivcontext. null si no hay dato. */
  frontSkew: number | null;
}): EarningsFlag {
  if (!input.nextEarnings) return "no_aplica";
  const earnings = new Date(`${input.nextEarnings}T00:00:00Z`).getTime();
  const exp = new Date(`${input.expiration}T00:00:00Z`).getTime();
  if (earnings > exp) return "fuera";
  // Cae dentro del vencimiento. ¿Lo confirma el mercado?
  return (input.frontSkew ?? 0) > 10 ? "dentro_confirmado" : "dentro";
}

// ── Fetch (I/O — no se testea) ─────────────────────────────────────────

/**
 * Próximo earnings directo de MarketSnack (`earnings_date` en /api/assets/X).
 * Devuelve null si no está poblado (ETF, o MarketSnack todavía no lo publicó)
 * — falla en silencio porque esto es solo un proxy, no un dato crítico.
 */
export async function fetchNextEarnings(ticker: string): Promise<string | null> {
  const cookieHeader = process.env.MARKETSNACK_COOKIE;
  if (!cookieHeader || !cookieHeader.trim()) return null;
  const clean = ticker.trim().toUpperCase();
  const url = `https://app.marketsnack.com/api/assets/${encodeURIComponent(clean)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", Cookie: cookieHeader.trim() },
    cache: "no-store",
    redirect: "manual",
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const json = (await res.json().catch(() => null)) as { earnings_date?: string } | null;
  return json?.earnings_date ? json.earnings_date.slice(0, 10) : null;
}

// NOTA (limitación declarada): el escaneo Wheel real (app/api/wheel/route.ts)
// siempre llama a esta función con frontSkew: null, porque ese escaneo no
// calcula ivContextScore por ticker (no tiene el flujo de MarketSnack por
// símbolo). En consecuencia, HOY "dentro_confirmado" es INALCANZABLE en
// producción: el flag efectivo depende solo de si MarketSnack ya publicó
// `earnings_date` para ese ticker. El parámetro frontSkew se conserva para el
// día en que el skew esté disponible en el escaneo Wheel; los tests unitarios
// de este módulo sí lo ejercitan pasando un valor > 10 a propósito, y eso está bien.
export async function earningsForTicker(input: {
  ticker: string;
  expiration: string;
  frontSkew: number | null;
  now: Date;
}): Promise<EarningsFlag> {
  const nextEarnings = await fetchNextEarnings(input.ticker);
  return earningsFlag({ nextEarnings, expiration: input.expiration, frontSkew: input.frontSkew });
}
