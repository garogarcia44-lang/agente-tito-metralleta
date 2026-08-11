// Cliente del endpoint no oficial de gráficos de Yahoo Finance — velas del
// subyacente, gratis y sin API key. MarketSnack no expone histórico de
// precio del subyacente (solo cadena de opciones y flujo), así que esta es
// la pieza que falta para la gráfica y el análisis de niveles/GEX.
//
// (Se probó Stooq primero, pero ahora exige un challenge anti-bot en
// JavaScript que un fetch de servidor no puede resolver — verificado en vivo.
// Yahoo sí responde JSON directo con un User-Agent de navegador normal.)

import type { DailyBar, TfBar } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

interface YahooQuote {
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  close?: (number | null)[];
}
interface YahooChartResponse {
  chart?: {
    result?: { timestamp?: number[]; indicators?: { quote?: YahooQuote[] } }[];
  };
}

async function fetchChart(
  ticker: string,
  interval: string,
  period1: number,
  period2: number,
): Promise<{ time: number; open: number; high: number; low: number; close: number }[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?interval=${interval}&period1=${period1}&period2=${period2}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) return [];
  const json = (await res.json().catch(() => null)) as YahooChartResponse | null;
  const result = json?.chart?.result?.[0];
  const times = result?.timestamp ?? [];
  const q = result?.indicators?.quote?.[0] ?? {};

  const bars: { time: number; open: number; high: number; low: number; close: number }[] = [];
  for (let i = 0; i < times.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({ time: times[i], open: o, high: h, low: l, close: c });
  }
  return bars;
}

/** Barras diarias del subyacente en los últimos `days` días (para la gráfica). */
export async function fetchDailyBars(ticker: string, days = 365): Promise<DailyBar[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 60 * 60;
  const bars = await fetchChart(ticker, "1d", from, to);
  return bars.map((b) => ({
    time: new Date(b.time * 1000).toISOString().slice(0, 10),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
}

/**
 * Barras del subyacente (diario o intradía) con tiempo UNIX en segundos.
 * Yahoo soporta 1m (7 días), 5m/15m (60 días) — de sobra para lo que pide la
 * app hoy (5min/5d y 15min/10d, ver app/api/bars/route.ts).
 */
export async function fetchBars(
  ticker: string,
  multiplier: number,
  timespan: "day" | "minute",
  days: number,
): Promise<TfBar[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 60 * 60;
  const interval =
    timespan === "day" ? "1d" : multiplier <= 1 ? "1m" : multiplier <= 5 ? "5m" : "15m";
  return fetchChart(ticker, interval, from, to);
}
