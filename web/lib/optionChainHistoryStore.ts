// Historial diario de la cadena de opciones POR CONTRATO (strike, tipo, open
// interest) — no el resumen agregado que ya guarda chainStore.ts (ese es para
// el sub-agente de Estructura). Esto existe con un solo propósito: guardar lo
// que hoy NO se guarda para poder backtestear intradía con cadena real dentro
// de unas semanas (lib/backtest.ts hoy corre sin cadena histórica porque no
// existe — ver el comentario al principio de ese archivo).
//
// Se aprovecha que app/api/scan/intraday y app/api/scan/swing YA descargan la
// cadena completa de cada ticker que analizan (fetchOptionChain) — este store
// solo la persiste también, sin ninguna llamada extra a MarketSnack.
//
// Una foto por día de mercado (ET); si el mismo ticker se analiza varias veces
// el mismo día (intradía corre cada 30 min), la última corrida reemplaza a la
// anterior — mismo patrón que chainStore.ts, y de paso queda la foto más
// completa del día (cerca del cierre) en vez de la de apertura.

import { promises as fs } from "fs";
import path from "path";
import { marketDateStr } from "./occ";
import type { Row } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "chain-rows");

/**
 * Un día completo (95 tickers, medido en vivo el 2026-08-14) pesa ~57 MB, así
 * que 365 días son ~21 GB — Jorge confirmó que puede usar hasta 50 GB para
 * esto ("entre más información tengamos mejor"), con margen para que la lista
 * de tickers rastreados crezca con el tiempo. Un año completo de cadena real
 * por delante, no solo las 6 semanas que alcanzaron para backtestear swing.
 */
export const HISTORY_DAYS = 365;

export interface ChainRowsSnapshot {
  date: string; // fecha de mercado (ET), YYYY-MM-DD
  savedAt: string;
  underlyingPrice: number | null;
  rows: Row[];
}

export interface OptionChainHistory {
  ticker: string;
  updatedAt: string;
  snapshots: ChainRowsSnapshot[]; // más reciente primero
}

function fileFor(ticker: string): string {
  const safe = ticker.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "");
  return path.join(DATA_DIR, `${safe}.json`);
}

export async function loadOptionChainHistory(ticker: string): Promise<OptionChainHistory | null> {
  try {
    const raw = await fs.readFile(fileFor(ticker), "utf8");
    const parsed = JSON.parse(raw) as OptionChainHistory;
    return Array.isArray(parsed.snapshots) ? parsed : null;
  } catch {
    return null; // aún no hay historial para este ticker
  }
}

/** Snapshot del día de mercado (ET) de `now`. Un solo snapshot por fecha — se sustituye si ya existía. */
export async function saveOptionChainSnapshot(
  ticker: string, rows: Row[], underlyingPrice: number | null, now: Date = new Date(),
): Promise<OptionChainHistory> {
  const clean = ticker.trim().toUpperCase();
  const date = marketDateStr(now);

  const snapshot: ChainRowsSnapshot = { date, savedAt: now.toISOString(), underlyingPrice, rows };

  const existing = await loadOptionChainHistory(clean);
  const byDate = new Map<string, ChainRowsSnapshot>();
  for (const snap of existing?.snapshots ?? []) byDate.set(snap.date, snap);
  byDate.set(date, snapshot);

  const snapshots = [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, HISTORY_DAYS);

  const payload: OptionChainHistory = { ticker: clean, updatedAt: now.toISOString(), snapshots };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(fileFor(clean), JSON.stringify(payload), "utf8");
  return payload;
}
