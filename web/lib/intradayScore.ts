// Score de confluencia para detección intradía (Fase C).
//
// El filtro de "¿es un candidato siquiera?" ya lo hace `lib/risk.ts`
// (passesQualityFilter + isTradeableIdea + withinMoneyness) antes de llegar aquí.
// Este módulo responde una pregunta distinta: de los candidatos que ya pasaron ese
// filtro, ¿cuáles tienen SUFICIENTE CONFLUENCIA real (flujo + GEX + niveles +
// liquidez + frescura) como para justificar un plan AUTO y una alerta?
//
// Cada sub-score usa datos reales ya calculados en otro lugar (unusualTradeScore,
// gexAnalysis, findLevels, openInterest, timestamp) — no inventa una fuente nueva.
// Las únicas dos constantes que este módulo "decide" por su cuenta son los pesos
// de la mezcla y el umbral final; van documentadas y exportadas (no elegidas en
// silencio) para que se puedan auditar o pedir que se ajusten con el tiempo, tal
// como pide el usuario para el ciclo de mejora continua.

import type { FlowRow } from "./flow";
import { unusualTradeScore } from "./flow";
import type { GexAnalysis } from "./gex";
import type { Level } from "./levels";

export type Direction = "up" | "down";

export const WEIGHTS = {
  flow: 0.3,
  gex: 0.25,
  levels: 0.25,
  liquidity: 0.1,
  freshness: 0.1,
} as const;

/**
 * Umbral final (0-100) para que un candidato dispare un plan AUTO + alerta.
 * Se arranca estricto a propósito: es más barato perderse una oportunidad al
 * principio que llenar "Mis Trades" de planes de baja convicción. Se ajusta con
 * el tiempo dentro del ciclo de aprendizaje aprobado (fase futura), no a mano acá.
 */
export const INTRADAY_SCORE_THRESHOLD = 70;

function directionOf(row: FlowRow): Direction | null {
  if (row.type === "call") return "up";
  if (row.type === "put") return "down";
  return null;
}

/** 0-100 a partir del 0-10 de unusualTradeScore (ya pasó el umbral de isTradeableIdea). */
function flowScore(row: FlowRow): number {
  return unusualTradeScore(row).total * 10;
}

/** ¿El régimen de gamma empuja en la misma dirección que el flujo, o en contra? */
function gexScore(gex: GexAnalysis, direction: Direction): number {
  if (gex.direction === direction) return gex.confidence;
  if (gex.direction === null || gex.direction === "flat") return 35;
  return Math.max(0, 30 - gex.confidence * 0.3); // gamma va en contra del flujo
}

/** ¿El objetivo cae en un nivel real (soporte/resistencia) o en el borde de 1σ sin respaldo? */
function levelScore(targetLevel: Level | null): number {
  return targetLevel ? targetLevel.strength : 30;
}

/** Cadena ilíquida (ya detectada por gexAnalysis) y open interest real del contrato. */
function liquidityScore(row: FlowRow, gex: GexAnalysis): number {
  if (gex.lowLiquidity) return 20;
  if (row.openInterest >= 100) return 90;
  if (row.openInterest >= 20) return 60;
  return 40;
}

/** Qué tan reciente es el trade que originó la señal. */
function freshnessScore(row: FlowRow, now: Date): number {
  const minutesAgo = (now.getTime() - new Date(row.timestamp).getTime()) / 60_000;
  if (!Number.isFinite(minutesAgo) || minutesAgo < 0) return 10;
  if (minutesAgo <= 5) return 100;
  if (minutesAgo <= 15) return 80;
  if (minutesAgo <= 30) return 60;
  if (minutesAgo <= 60) return 35;
  return 10;
}

export interface IntradayScoreInput {
  row: FlowRow;
  gex: GexAnalysis;
  targetLevel: Level | null;
  now: Date;
}

export interface IntradayScoreBreakdown {
  direction: Direction | null;
  flow: number;
  gex: number;
  levels: number;
  liquidity: number;
  freshness: number;
  /** 0-100, mezcla ponderada de los 5 sub-scores. */
  total: number;
  /** true si total >= INTRADAY_SCORE_THRESHOLD y la dirección es determinable. */
  passes: boolean;
}

export function scoreIntradayCandidate(input: IntradayScoreInput): IntradayScoreBreakdown {
  const { row, gex, targetLevel, now } = input;
  const direction = directionOf(row);

  if (direction === null) {
    return { direction: null, flow: 0, gex: 0, levels: 0, liquidity: 0, freshness: 0, total: 0, passes: false };
  }

  const flow = flowScore(row);
  const gexC = gexScore(gex, direction);
  const levels = levelScore(targetLevel);
  const liquidity = liquidityScore(row, gex);
  const freshness = freshnessScore(row, now);

  const total =
    flow * WEIGHTS.flow +
    gexC * WEIGHTS.gex +
    levels * WEIGHTS.levels +
    liquidity * WEIGHTS.liquidity +
    freshness * WEIGHTS.freshness;

  return {
    direction, flow, gex: gexC, levels, liquidity, freshness,
    total, passes: total >= INTRADAY_SCORE_THRESHOLD,
  };
}
