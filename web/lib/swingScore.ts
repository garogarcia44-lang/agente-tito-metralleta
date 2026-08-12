// Score de confluencia para detección swing (Fase C-swing).
//
// Mismo filtro de entrada que intradía (lib/risk.ts) y mismos cuatro sub-scores
// compartidos (lib/confluenceScore.ts: flujo, GEX, nivel, liquidez). Lo que cambia
// es el quinto factor: en vez de qué tan reciente es el trade (frescura), acá
// importa la PERSISTENCIA — ¿este ticker ha tenido varios prints inusuales en la
// misma dirección en los últimos días, o es un solo trade suelto? Un swing se
// arma con una tesis que se sostiene en el tiempo, no con un print de hace 2 minutos.
//
// SWING_MIN_DTE es un filtro estructural, no de confluencia: sin suficientes días
// al vencimiento, el theta se come la posición antes de que un movimiento de varios
// días tenga tiempo de desarrollarse. Se aplica ANTES de puntuar (en la ruta), no
// es parte de la mezcla ponderada.

import type { FlowRow } from "./flow";
import type { GexAnalysis } from "./gex";
import type { Level } from "./levels";
import { isTradeableIdea } from "./risk";
import {
  directionOf, flowScore, gexScore, levelScore, liquidityScore, type Direction,
} from "./confluenceScore";
import { DEFAULT_SCANNER_RULES } from "./scannerRules";

export type { Direction };

/**
 * DTE mínimo para considerar un contrato "swing". Por debajo de esto ya lo cubre
 * el escaneo intradía (lib/intradayScore.ts) — swing empieza donde intradía se
 * queda sin tiempo para que la tesis se desarrolle.
 */
export const SWING_MIN_DTE = 15;

export const WEIGHTS = {
  flow: 0.25,
  gex: 0.25,
  levels: 0.25,
  liquidity: 0.1,
  persistence: 0.15,
} as const;

/**
 * Mismo umbral estricto que intradía — ver intradayScore.ts para el razonamiento.
 * El valor por defecto vive en lib/scannerRules.ts; solo cambia si se aprueba
 * una propuesta del ciclo de mejora (lib/ruleProposals.ts).
 */
export const SWING_SCORE_THRESHOLD = DEFAULT_SCANNER_RULES.swingThreshold;

/**
 * Cuántos trades de calidad tradeable (mismo filtro que risk.ts) tiene este
 * ticker en la misma dirección, dentro de la ventana escaneada (varios días).
 * 1 print suelto no es una tesis; varios sí.
 */
function persistenceScore(ownFlow: FlowRow[], direction: Direction): number {
  const count = ownFlow.filter((r) => isTradeableIdea(r) && directionOf(r) === direction).length;
  if (count >= 4) return 100;
  if (count === 3) return 80;
  if (count === 2) return 60;
  if (count === 1) return 40;
  return 20;
}

export interface SwingScoreInput {
  row: FlowRow;
  ownFlow: FlowRow[];
  gex: GexAnalysis;
  targetLevel: Level | null;
  /** Umbral a usar para `passes` — por defecto SWING_SCORE_THRESHOLD. */
  threshold?: number;
}

export interface SwingScoreBreakdown {
  direction: Direction | null;
  flow: number;
  gex: number;
  levels: number;
  liquidity: number;
  persistence: number;
  /** 0-100, mezcla ponderada de los 5 sub-scores. */
  total: number;
  /** true si total >= SWING_SCORE_THRESHOLD y la dirección es determinable. */
  passes: boolean;
}

export function scoreSwingCandidate(input: SwingScoreInput): SwingScoreBreakdown {
  const { row, ownFlow, gex, targetLevel, threshold = SWING_SCORE_THRESHOLD } = input;
  const direction = directionOf(row);

  if (direction === null) {
    return { direction: null, flow: 0, gex: 0, levels: 0, liquidity: 0, persistence: 0, total: 0, passes: false };
  }

  const flow = flowScore(row);
  const gexC = gexScore(gex, direction);
  const levels = levelScore(targetLevel);
  const liquidity = liquidityScore(row, gex);
  const persistence = persistenceScore(ownFlow, direction);

  const total =
    flow * WEIGHTS.flow +
    gexC * WEIGHTS.gex +
    levels * WEIGHTS.levels +
    liquidity * WEIGHTS.liquidity +
    persistence * WEIGHTS.persistence;

  return {
    direction, flow, gex: gexC, levels, liquidity, persistence,
    total, passes: total >= threshold,
  };
}
