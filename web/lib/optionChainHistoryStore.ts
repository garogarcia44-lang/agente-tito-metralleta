// Historial diario de la cadena de opciones POR CONTRATO (strike, tipo, open
// interest) — no el resumen agregado que ya guarda chainStore.ts (ese es para
// el sub-agente de Estructura). Esto existe con un solo propósito: guardar lo
// que hoy NO se guarda para poder backtestear intradía con cadena real dentro
// de unas semanas (lib/backtest.ts hoy corre sin cadena histórica porque no
// existe — ver el comentario al principio de ese archivo).
//
// Se aprovecha que app/api/scan/intraday, app/api/scan/swing y
// app/api/chain-snapshot YA descargan la cadena completa de cada ticker que
// analizan (fetchOptionChain) — este store solo la persiste también, sin
// ninguna llamada extra a MarketSnack.
//
// UN ARCHIVO POR TICKER POR DÍA (data/chain-rows/{TICKER}/{FECHA}.json), no un
// solo JSON por ticker que va creciendo — a propósito, pensando en que esto se
// va a respaldar en iCloud Drive (2 TB disponibles, confirmado con Jorge):
// un archivo por día es inmutable una vez escrito, así que iCloud solo sube el
// día nuevo cada vez. Con un solo archivo gigante por ticker, subir un día más
// de datos habría obligado a resubir TODO el historial acumulado cada vez —
// cada vez más lento según fuera creciendo el año.

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
  snapshots: ChainRowsSnapshot[]; // más reciente primero
}

function tickerDir(ticker: string): string {
  const safe = ticker.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "");
  return path.join(DATA_DIR, safe);
}

function fileFor(ticker: string, date: string): string {
  return path.join(tickerDir(ticker), `${date}.json`);
}

/** Lee todas las fotos guardadas de un ticker, más reciente primero. */
export async function loadOptionChainHistory(ticker: string): Promise<OptionChainHistory | null> {
  const dir = tickerDir(ticker);
  const files = await fs.readdir(dir).catch(() => null);
  if (!files || files.length === 0) return null;

  const dates = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort().reverse();
  const snapshots: ChainRowsSnapshot[] = [];
  for (const date of dates) {
    const raw = await fs.readFile(path.join(dir, `${date}.json`), "utf8").catch(() => null);
    if (!raw) continue;
    try {
      snapshots.push(JSON.parse(raw) as ChainRowsSnapshot);
    } catch {
      // archivo corrupto — se ignora, no tumba el resto del historial
    }
  }
  return { ticker: ticker.trim().toUpperCase(), snapshots };
}

/**
 * Guarda (o sustituye) la foto del día de mercado (ET) de `now` — un archivo
 * inmutable por fecha. Si el mismo ticker se analiza varias veces el mismo día
 * (intradía corre cada 30 min), la corrida más tardía reemplaza a la anterior,
 * pero solo se reescribe el archivo de HOY, nunca los de días anteriores.
 * También poda los archivos más viejos que HISTORY_DAYS.
 */
export async function saveOptionChainSnapshot(
  ticker: string, rows: Row[], underlyingPrice: number | null, now: Date = new Date(),
): Promise<void> {
  const clean = ticker.trim().toUpperCase();
  const date = marketDateStr(now);
  const dir = tickerDir(clean);

  const snapshot: ChainRowsSnapshot = { date, savedAt: now.toISOString(), underlyingPrice, rows };
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fileFor(clean, date), JSON.stringify(snapshot), "utf8");

  await pruneOld(dir);
}

/** Borra los archivos más viejos que sobren de la ventana de HISTORY_DAYS. */
async function pruneOld(dir: string): Promise<void> {
  const files = await fs.readdir(dir).catch(() => []);
  const dates = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort().reverse();
  if (dates.length <= HISTORY_DAYS) return;

  const toDelete = dates.slice(HISTORY_DAYS);
  await Promise.all(toDelete.map((d) => fs.unlink(path.join(dir, `${d}.json`)).catch(() => null)));
}
