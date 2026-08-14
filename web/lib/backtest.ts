// Backtest de la detección automática (Fase C) contra flujo histórico REAL ya
// guardado (data/trades/{TICKER}.json, acumulado por /api/ideas desde que existe
// el proyecto) + barras reales de Yahoo Finance. Responde la pregunta que nunca
// se había probado: si esta estrategia hubiera estado corriendo, ¿habría ganado?
//
// Reusa el MISMO código que corre en vivo (scoreIntradayCandidate/scoreSwingCandidate,
// derivePlanTargets, gexAnalysis, findLevels) — no es una reimplementación
// paralela que se pueda desincronizar del sistema real.
//
// LIMITACIÓN HONESTA (documentarla siempre, no esconderla): no existe cadena de
// opciones histórica — MarketSnack solo da la cadena de HOY. Así que:
//   · GEX se calcula solo con la parte de flujo (trades reales), sin la parte
//     estructural de open interest de toda la cadena (60% del peso en vivo,
//     ver GEX_WEIGHT en gex.ts) — se le pasa `rows: []`.
//   · Niveles se calculan solo con pivotes de precio + flujo, sin los "muros"
//     de la cadena de opciones.
//   · El resultado (hit/stop) se mide con velas DIARIAS de Yahoo, no
//     intradía — así que "intradía" en el backtest en realidad mide el mismo
//     día + el día siguiente, lo más fino que da el dato disponible.
// El score del backtest es entonces una versión PARCIAL del score real (más
// pesado hacia flujo que en producción) — sirve para validar la parte que sí
// se puede probar con honestidad, no es un reflejo exacto 1:1 de lo que ve el
// escáner en vivo.

import type { FlowRow } from "./flow";
import { isTradeableIdea, withinMoneyness } from "./risk";
import { dedupeByContract } from "./flow";
import { gexAnalysis, estimateIV, type TradeLite } from "./gex";
import { findLevels, type FlowLevel } from "./levels";
import { derivePlanTargets } from "./planTargets";
import { probTouch } from "./expectedMove";
import {
  scoreIntradayCandidate, type IntradayScoreBreakdown,
} from "./intradayScore";
import { scoreSwingCandidate, SWING_MIN_DTE, type SwingScoreBreakdown } from "./swingScore";
import type { DailyBar } from "./types";

export type Outcome = "target" | "stop" | "timeout";

export interface BacktestEvent {
  ticker: string;
  symbol: string;
  timestamp: string;
  horizon: "intradia" | "swing";
  direction: "up" | "down";
  score: number;
  breakdown: IntradayScoreBreakdown | SwingScoreBreakdown;
  spot: number;
  targetUnderlying: number;
  stopUnderlying: number;
  estimatedProbability: number | null;
  usedFallbackTarget: boolean;
  usedFallbackStop: boolean;
}

export interface BacktestResult extends BacktestEvent {
  outcome: Outcome;
  sessionsToOutcome: number | null;
}

const INTRADAY_WINDOW_SESSIONS = 2; // el mismo día + 1 más, lo más fino que da una vela diaria
const SWING_WINDOW_SESSIONS = 10;

function barIndexOf(bars: DailyBar[], dateStr: string): number {
  // primera barra con time >= dateStr (los eventos casi nunca caen justo en una barra)
  return bars.findIndex((b) => b.time >= dateStr);
}

/**
 * ¿El objetivo o el stop se tocó primero, mirando velas diarias hacia adelante?
 * Si ambos se tocan el mismo día, no se puede saber el orden con una vela diaria
 * — se asume conservador (stop primero) salvo que la apertura del día esté
 * claramente más cerca del objetivo que del stop.
 */
function resolveOutcome(
  bars: DailyBar[], startIdx: number, windowSessions: number,
  bullish: boolean, target: number, stop: number,
): { outcome: Outcome; sessionsToOutcome: number | null } {
  const end = Math.min(bars.length, startIdx + windowSessions);
  for (let i = startIdx; i < end; i++) {
    const bar = bars[i];
    const hitTarget = bullish ? bar.high >= target : bar.low <= target;
    const hitStop = bullish ? bar.low <= stop : bar.high >= stop;
    if (hitTarget && hitStop) {
      const distToTarget = Math.abs(bar.open - target);
      const distToStop = Math.abs(bar.open - stop);
      return { outcome: distToTarget < distToStop ? "target" : "stop", sessionsToOutcome: i - startIdx + 1 };
    }
    if (hitTarget) return { outcome: "target", sessionsToOutcome: i - startIdx + 1 };
    if (hitStop) return { outcome: "stop", sessionsToOutcome: i - startIdx + 1 };
  }
  return { outcome: "timeout", sessionsToOutcome: null };
}

export interface SimulateOptions {
  /** No evaluar eventos sin al menos esta cantidad de sesiones futuras disponibles. */
  minForwardSessions?: number;
}

/**
 * Simula un ticker completo: por cada candidato que hubiera pasado el filtro de
 * calidad (lib/risk.ts) en su momento, calcula el mismo score que usa el
 * escáner en vivo usando SOLO datos disponibles hasta ese instante (sin mirar
 * el futuro), deriva objetivo/stop, y resuelve el resultado contra las barras
 * reales posteriores.
 */
export function simulateTicker(
  ticker: string, allRows: FlowRow[], bars: DailyBar[], opts: SimulateOptions = {},
): BacktestResult[] {
  const minForward = opts.minForwardSessions ?? 1;
  const sorted = [...allRows].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const candidates = dedupeByContract(
    sorted.filter((r) => isTradeableIdea(r) && withinMoneyness(r) && r.type !== "unknown"),
  ).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const results: BacktestResult[] = [];

  for (const candidate of candidates) {
    const now = new Date(candidate.timestamp);
    const dateStr = candidate.timestamp.slice(0, 10);

    // Solo lo que ya había pasado en ese momento — nada de mirar al futuro.
    const barsUpTo = bars.filter((b) => b.time <= dateStr);
    const flowUpTo = sorted.filter((r) => Date.parse(r.timestamp) <= now.getTime());
    if (barsUpTo.length < 20) continue; // sin suficiente historial para estimar IV/niveles

    const spot = candidate.assetPrice > 0 ? candidate.assetPrice : barsUpTo[barsUpTo.length - 1].close;
    if (!(spot > 0)) continue;

    const closes = barsUpTo.map((b) => b.close);
    const iv = candidate.iv > 0 ? candidate.iv : estimateIV(closes);

    const ownFlow = flowUpTo.filter((r) => r.underlying === ticker);
    const flowTrades: TradeLite[] = ownFlow.map((r) => ({
      strike: r.strike, type: r.type, premium: r.premium, gamma: r.gamma,
    }));
    // Sin cadena histórica — ver limitación documentada arriba del archivo.
    const gex = gexAnalysis({ rows: [], closes, spot, trades: flowTrades, now });

    const flowLevels: FlowLevel[] = ownFlow.map((r) => ({
      strike: r.strike, type: r.type, aggression: r.aggression, premium: r.premium,
    }));
    const levels = findLevels({ bars: barsUpTo, spot, chain: [], flows: flowLevels, gex: [], now });

    const days = candidate.dte ?? 0;
    if (days <= 0) continue;
    const targets = derivePlanTargets({
      spot, iv, days,
      contractType: candidate.type === "call" ? "call" : "put",
      strike: candidate.strike ?? spot,
      entryPrice: candidate.price,
      levels,
    });

    const isSwing = days >= SWING_MIN_DTE;
    const breakdown = isSwing
      ? scoreSwingCandidate({ row: candidate, ownFlow, gex, targetLevel: targets.targetLevel })
      : scoreIntradayCandidate({ row: candidate, gex, targetLevel: targets.targetLevel, now });

    if (breakdown.direction === null) continue;

    const startIdx = barIndexOf(bars, dateStr);
    if (startIdx < 0) continue;
    const window = isSwing ? SWING_WINDOW_SESSIONS : INTRADAY_WINDOW_SESSIONS;
    if (bars.length - startIdx < Math.max(minForward, 1)) continue; // sin resultado futuro conocido todavía

    const probability = Math.round(probTouch(spot, targets.targetUnderlying, iv, days) * 100);
    const { outcome, sessionsToOutcome } = resolveOutcome(
      bars, startIdx, window, breakdown.direction === "up", targets.targetUnderlying, targets.stopUnderlying,
    );

    results.push({
      ticker, symbol: candidate.symbol, timestamp: candidate.timestamp,
      horizon: isSwing ? "swing" : "intradia",
      direction: breakdown.direction,
      score: breakdown.total,
      breakdown,
      spot, targetUnderlying: targets.targetUnderlying, stopUnderlying: targets.stopUnderlying,
      estimatedProbability: Number.isFinite(probability) ? probability : null,
      usedFallbackTarget: targets.usedFallbackTarget, usedFallbackStop: targets.usedFallbackStop,
      outcome, sessionsToOutcome,
    });
  }

  return results;
}

// ---------- agregación ----------

export interface ThresholdBucket {
  threshold: number;
  n: number;
  wins: number;
  losses: number;
  timeouts: number;
  hitRate: number | null; // wins / (wins+losses), excluye timeouts
}

/** Para cada umbral candidato, ¿qué hit rate hubiera dado quedarse solo con score >= umbral? */
export function sweepThresholds(
  results: BacktestResult[], thresholds: number[] = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90],
): ThresholdBucket[] {
  return thresholds.map((threshold) => {
    const above = results.filter((r) => r.score >= threshold);
    const wins = above.filter((r) => r.outcome === "target").length;
    const losses = above.filter((r) => r.outcome === "stop").length;
    const timeouts = above.filter((r) => r.outcome === "timeout").length;
    const resolved = wins + losses;
    return { threshold, n: above.length, wins, losses, timeouts, hitRate: resolved > 0 ? (wins / resolved) * 100 : null };
  });
}

export interface FactorCorrelation {
  factor: string;
  /** Promedio del sub-score entre los que ganaron. */
  avgAmongWins: number;
  /** Promedio del sub-score entre los que perdieron. */
  avgAmongLosses: number;
  /** avgAmongWins - avgAmongLosses — positivo = el factor sí distingue ganadores de perdedores. */
  separation: number;
}

/** ¿Cada sub-score es más alto en los que ganaron que en los que perdieron? Así se mide si un factor "predice" algo de verdad. */
export function factorSeparation(results: BacktestResult[]): FactorCorrelation[] {
  const resolved = results.filter((r) => r.outcome === "target" || r.outcome === "stop");
  const wins = resolved.filter((r) => r.outcome === "target");
  const losses = resolved.filter((r) => r.outcome === "stop");

  const factors = new Set<string>();
  for (const r of resolved) {
    const breakdown = r.breakdown as unknown as Record<string, unknown>;
    for (const k of Object.keys(breakdown)) {
      if (typeof breakdown[k] === "number" && k !== "total") factors.add(k);
    }
  }

  const avg = (rows: BacktestResult[], key: string) =>
    rows.length === 0 ? 0 : rows.reduce((s, r) => {
      const breakdown = r.breakdown as unknown as Record<string, number>;
      return s + (breakdown[key] ?? 0);
    }, 0) / rows.length;

  return [...factors].map((factor) => {
    const avgAmongWins = avg(wins, factor);
    const avgAmongLosses = avg(losses, factor);
    return { factor, avgAmongWins, avgAmongLosses, separation: avgAmongWins - avgAmongLosses };
  }).sort((a, b) => b.separation - a.separation);
}
