// Medición de resultados de "Mis Trades" — hit rate, P&L acumulado y qué tan
// calibradas están las probabilidades estimadas de los planes. Puro: recibe los
// planes ya cargados (paperPlansStore) y solo lee/agrega, no escribe nada.
//
// Esto es la base del "aprendizaje continuo" que pidió el usuario — mide, no
// ajusta. El ciclo de mejora controlada (ajustar reglas de detección según estos
// resultados, con aprobación humana en cada cambio) es una fase futura y
// separada, aprobada aparte.

import type { PaperPlan } from "./paperPlan";
import { planPnl } from "./paperPlan";

/**
 * Mínimo de planes resueltos para que un bucket de calibración cuente como
 * significativo. Mismo número que lib/prediction.ts (CALIBRATION.minSamples) —
 * no es un umbral nuevo inventado, es el precedente ya establecido en este
 * proyecto para "¿hay suficiente historial para confiar en esto?".
 */
export const CALIBRATION_MIN_SAMPLES = 5;

export interface ResultsSlice {
  label: string;
  total: number;
  /** pendiente + activa — todavía en juego. */
  open: number;
  /** Expiró sin activarse nunca (el gatillo no se cruzó a tiempo). */
  neverActivated: number;
  /** Se activó pero expiró sin tocar objetivo ni stop. */
  timedOut: number;
  wins: number;
  losses: number;
  /** wins + losses — lo único que cuenta para el hit rate. */
  resolved: number;
  /** wins / resolved × 100. null si no hay resueltos todavía. */
  hitRate: number | null;
  /** Suma de P&L en $ de los planes ganados/perdidos. */
  totalPnl: number;
  avgPnl: number | null;
}

function emptySlice(label: string): ResultsSlice {
  return {
    label, total: 0, open: 0, neverActivated: 0, timedOut: 0,
    wins: 0, losses: 0, resolved: 0, hitRate: null, totalPnl: 0, avgPnl: null,
  };
}

export function sliceResults(plans: PaperPlan[], label: string): ResultsSlice {
  const s = emptySlice(label);
  s.total = plans.length;
  for (const p of plans) {
    if (p.status === "pendiente" || p.status === "activa") { s.open++; continue; }
    if (p.status === "expirada") {
      if (p.entryPrice == null) s.neverActivated++;
      else s.timedOut++;
      continue;
    }
    const pnl = planPnl(p) ?? 0;
    s.totalPnl += pnl;
    if (p.status === "ganada") s.wins++;
    else s.losses++;
  }
  s.resolved = s.wins + s.losses;
  s.hitRate = s.resolved > 0 ? (s.wins / s.resolved) * 100 : null;
  s.avgPnl = s.resolved > 0 ? s.totalPnl / s.resolved : null;
  return s;
}

export interface CalibrationBucket {
  label: string;
  min: number;
  max: number;
  /** Punto medio del bucket — lo que "debería" pasar si la probabilidad está bien calibrada. */
  predictedMid: number;
  /** Planes resueltos (ganada/perdida) cuya estimatedProbability cae en este bucket. */
  n: number;
  wins: number;
  /** wins / n × 100. null si n === 0. */
  actualRate: number | null;
  sufficientSample: boolean;
}

const BUCKETS: [number, number][] = [[0, 25], [25, 50], [50, 75], [75, 100]];

function buildCalibration(plans: PaperPlan[]): CalibrationBucket[] {
  const resolved = plans.filter(
    (p) => (p.status === "ganada" || p.status === "perdida") && p.estimatedProbability != null,
  );
  return BUCKETS.map(([min, max]) => {
    const inBucket = resolved.filter(
      (p) => p.estimatedProbability! >= min && (max === 100 ? p.estimatedProbability! <= max : p.estimatedProbability! < max),
    );
    const wins = inBucket.filter((p) => p.status === "ganada").length;
    const n = inBucket.length;
    return {
      label: `${min}-${max}%`, min, max, predictedMid: (min + max) / 2,
      n, wins,
      actualRate: n > 0 ? (wins / n) * 100 : null,
      sufficientSample: n >= CALIBRATION_MIN_SAMPLES,
    };
  });
}

export interface PaperResultsReport {
  overall: ResultsSlice;
  byHorizon: { intradia: ResultsSlice; swing: ResultsSlice };
  byOrigin: { auto: ResultsSlice; manual: ResultsSlice };
  calibration: CalibrationBucket[];
}

export function buildPaperResults(plans: PaperPlan[]): PaperResultsReport {
  return {
    overall: sliceResults(plans, "Todos"),
    byHorizon: {
      intradia: sliceResults(plans.filter((p) => p.horizon === "intradia"), "Intradía"),
      swing: sliceResults(plans.filter((p) => p.horizon === "swing"), "Swing"),
    },
    byOrigin: {
      auto: sliceResults(plans.filter((p) => p.origin === "auto"), "Auto"),
      manual: sliceResults(plans.filter((p) => p.origin === "manual"), "Manual"),
    },
    calibration: buildCalibration(plans),
  };
}
