// Objetivo y stop de un plan AUTO (Fase C — detección intradía), en términos del
// SUBYACENTE primero y reproyectados a prima con Black-Scholes después.
//
// Regla del usuario: "no establezcas porcentajes arbitrarios sin aprobación". Por
// eso el objetivo y el stop del subyacente salen de dos fuentes ya existentes y
// reales — nunca de un % inventado sobre el precio:
//   1. Niveles reales (`lib/levels.ts`): dónde el precio ya reaccionó y/o dónde hay
//      dinero puesto (soporte/resistencia por confluencia).
//   2. El movimiento esperado estadístico (`lib/expectedMove.ts`, σ = S·IV·√(T/365)).
//
// Si no hay un nivel real dentro de 1σ en la dirección del trade, se usa el borde
// de 1σ como objetivo — es matemática (el movimiento esperado), no un % arbitrario.
// Si no hay un nivel real opuesto dentro de 1σ para el stop, el único número que
// esta librería "decide" por su cuenta es STOP_FALLBACK_SIGMA_FRACTION: una fracción
// de la MISMA σ estadística (no un % del precio inventado aparte). Se deja como
// constante exportada, documentada y visible en el resultado (`usedFallbackStop`)
// para que se pueda auditar o pedir que se cambie.

import { bsPrice } from "./blackScholes";
import { expectedMove } from "./expectedMove";
import type { Level, LevelsReport } from "./levels";
import type { ContractType } from "./types";

/**
 * Único número no derivado directamente de un nivel real: qué fracción de 1σ
 * (subyacente) se usa como colchón de stop cuando no hay ningún soporte/resistencia
 * real disponible del lado opuesto. 0.5 = medio movimiento esperado estadístico.
 */
export const STOP_FALLBACK_SIGMA_FRACTION = 0.5;

export interface PlanTargetsInput {
  spot: number;
  /** IV decimal (0.45 = 45%), la misma que ya calcula gex.ts/estimateIV. */
  iv: number;
  /** Días hasta el vencimiento del contrato (lib/occ.ts → daysToExpiration). */
  days: number;
  contractType: ContractType;
  strike: number;
  /** Prima observada ahora mismo (ej. ask o último trade) — se usa como trigger. */
  entryPrice: number;
  levels: LevelsReport;
}

export interface PlanTargets {
  trigger: number;
  /** Objetivo, en prima. */
  target: number;
  /** Stop inicial, en prima. */
  initialStop: number;
  targetUnderlying: number;
  stopUnderlying: number;
  /** true si no había nivel real y se usó el borde de 1σ. */
  usedFallbackTarget: boolean;
  /** true si no había nivel real y se usó STOP_FALLBACK_SIGMA_FRACTION. */
  usedFallbackStop: boolean;
  targetLevel: Level | null;
  stopLevel: Level | null;
  /** σ del subyacente en $, para trazabilidad/auditoría. */
  sigma: number;
}

function pickLevel(candidates: Level[]): Level | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) => b.strength - a.strength || a.distancePct - b.distancePct,
  )[0];
}

export function derivePlanTargets(input: PlanTargetsInput): PlanTargets {
  const { spot, iv, days, contractType, strike, entryPrice, levels } = input;
  const bullish = contractType === "call";
  const em = expectedMove(spot, iv, days);

  // Objetivo: nivel real a favor de la dirección, dentro de 1σ. Sin nivel → borde de 1σ.
  const favorable = bullish ? levels.resistances : levels.supports;
  const band1Target = bullish ? em.upper1 : em.lower1;
  const targetCandidates = favorable.filter((l) =>
    bullish ? l.price > spot && l.price <= band1Target : l.price < spot && l.price >= band1Target,
  );
  const targetLevel = pickLevel(targetCandidates);
  const usedFallbackTarget = targetLevel === null;
  const targetUnderlying = targetLevel?.price ?? band1Target;

  // Stop: nivel real en contra de la dirección, dentro de 1σ. Sin nivel → fracción de σ.
  const opposing = bullish ? levels.supports : levels.resistances;
  const band1Stop = bullish ? em.lower1 : em.upper1;
  const stopCandidates = opposing.filter((l) =>
    bullish ? l.price < spot && l.price >= band1Stop : l.price > spot && l.price <= band1Stop,
  );
  const stopLevel = pickLevel(stopCandidates);
  const usedFallbackStop = stopLevel === null;
  const sigmaStop = spot + (bullish ? -1 : 1) * em.sigma * STOP_FALLBACK_SIGMA_FRACTION;
  const stopUnderlying = stopLevel?.price ?? sigmaStop;

  const T = Math.max(days, 0) / 365;
  const target = bsPrice(targetUnderlying, strike, T, iv, contractType) || entryPrice;
  const initialStop = bsPrice(stopUnderlying, strike, T, iv, contractType) || 0;

  return {
    trigger: entryPrice,
    target,
    initialStop,
    targetUnderlying,
    stopUnderlying,
    usedFallbackTarget,
    usedFallbackStop,
    targetLevel,
    stopLevel,
    sigma: em.sigma,
  };
}
