// Funciones puras: sin I/O, fáciles de testear. Aquí viven las fórmulas del agente.

import type { ContractType, PriceSource, RawContract, Row } from "./types";

/**
 * Precio del contrato para el cálculo de Open Premium.
 * La fórmula del agente pide BID, pero el plan actual de Massive no devuelve quotes,
 * así que caemos a last_trade → day.close → day.vwap. Cuando haya bid, cambiar aquí.
 */
export function contractPrice(raw: RawContract): {
  price: number | null;
  source: PriceSource;
} {
  const lt = raw.last_trade?.price;
  if (typeof lt === "number" && lt > 0) return { price: lt, source: "last_trade" };
  const close = raw.day?.close;
  if (typeof close === "number" && close > 0) return { price: close, source: "day_close" };
  const vwap = raw.day?.vwap;
  if (typeof vwap === "number" && vwap > 0) return { price: vwap, source: "day_vwap" };
  return { price: null, source: "none" };
}

/** Open Premium = Open Interest × Precio del Contrato. Null si no hay precio. */
export function openPremium(openInterest: number, price: number | null): number | null {
  if (price === null) return null;
  return openInterest * price;
}

/** Notional Value = Open Interest × 100 × Strike (zonas de relevancia si expira ITM). */
export function notionalValue(
  openInterest: number,
  strike: number,
  sharesPerContract = 100,
): number {
  return openInterest * sharesPerContract * strike;
}

function normalizeType(t: string | undefined): ContractType {
  return t === "put" ? "put" : "call";
}

/** Convierte un contrato crudo de Massive en una Row lista para la tabla. */
export function toRow(raw: RawContract): Row {
  const openInterest = raw.open_interest ?? 0;
  const strike = raw.details?.strike_price ?? 0;
  const shares = raw.details?.shares_per_contract ?? 100;
  const { price, source } = contractPrice(raw);
  const bid = raw.last_quote?.bid;
  const ask = raw.last_quote?.ask;
  const mid = raw.last_quote?.mid;
  return {
    optionTicker: raw.details?.ticker ?? "",
    contractType: normalizeType(raw.details?.contract_type),
    expiration: raw.details?.expiration_date ?? "",
    strike,
    openInterest,
    volume: raw.day?.volume ?? 0,
    price,
    priceSource: source,
    bid: typeof bid === "number" && bid > 0 ? bid : null,
    ask: typeof ask === "number" && ask > 0 ? ask : null,
    mid: typeof mid === "number" && mid > 0 ? mid : null,
    openPremium: openPremium(openInterest, price),
    notionalValue: notionalValue(openInterest, strike, shares),
  };
}

export type TradeQuoteSide = "buy" | "sell";

export interface TradeQuote {
  price: number;
  /** "ask"/"bid"/"mid" (cotización real) o el priceSource de contractPrice como último recurso. */
  source: string;
}

/**
 * Cotización REALISTA para simular una entrada/salida de paper trading — no el
 * "precio de la fila" genérico que usa el resto de la app (Open Premium, GEX,
 * etc — ese no cambia). Comprar (entrar) cruza el spread hacia el ASK; vender
 * (salir/cerrar) cruza hacia el BID. Sin bid/ask reales (contrato ilíquido),
 * cae a mid y luego a lo que ya resuelve contractPrice (último trade, cierre,
 * vwap) — nunca inventa un precio.
 */
export function resolveTradeQuote(row: Row, side: TradeQuoteSide): TradeQuote | null {
  if (side === "buy" && row.ask != null) return { price: row.ask, source: "ask" };
  if (side === "sell" && row.bid != null) return { price: row.bid, source: "bid" };
  if (row.mid != null) return { price: row.mid, source: "mid" };
  if (row.price != null) return { price: row.price, source: row.priceSource };
  return null;
}

/** Ordena por Open Interest de mayor a menor (Tarea 1). Devuelve un array nuevo. */
export function sortByOpenInterestDesc(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => b.openInterest - a.openInterest);
}

/** Cantidad de fechas de vencimiento distintas presentes. */
export function countExpirations(rows: Row[]): number {
  return new Set(rows.map((r) => r.expiration).filter(Boolean)).size;
}
