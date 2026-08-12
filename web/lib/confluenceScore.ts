// Sub-scores de confluencia compartidos entre intradayScore.ts y swingScore.ts.
//
// Flujo, GEX, nivel y liquidez significan lo mismo sin importar el horizonte —
// lo que cambia entre intradía y swing es el quinto factor (frescura vs.
// persistencia), así que ese vive en cada módulo por separado.

import type { FlowRow } from "./flow";
import { unusualTradeScore } from "./flow";
import type { GexAnalysis } from "./gex";
import type { Level } from "./levels";

export type Direction = "up" | "down";

export function directionOf(row: FlowRow): Direction | null {
  if (row.type === "call") return "up";
  if (row.type === "put") return "down";
  return null;
}

/** 0-100 a partir del 0-10 de unusualTradeScore (ya pasó el umbral de isTradeableIdea). */
export function flowScore(row: FlowRow): number {
  return unusualTradeScore(row).total * 10;
}

/** ¿El régimen de gamma empuja en la misma dirección que el flujo, o en contra? */
export function gexScore(gex: GexAnalysis, direction: Direction): number {
  if (gex.direction === direction) return gex.confidence;
  if (gex.direction === null || gex.direction === "flat") return 35;
  return Math.max(0, 30 - gex.confidence * 0.3); // gamma va en contra del flujo
}

/** ¿El objetivo cae en un nivel real (soporte/resistencia) o en el borde de 1σ sin respaldo? */
export function levelScore(targetLevel: Level | null): number {
  return targetLevel ? targetLevel.strength : 30;
}

/** Cadena ilíquida (ya detectada por gexAnalysis) y open interest real del contrato. */
export function liquidityScore(row: FlowRow, gex: GexAnalysis): number {
  if (gex.lowLiquidity) return 20;
  if (row.openInterest >= 100) return 90;
  if (row.openInterest >= 20) return 60;
  return 40;
}
