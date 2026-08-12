// Ciclo de mejora controlada (última fase de la ampliación) — propone ajustes a
// los umbrales de score de la detección automática, NUNCA los aplica. Aplicar
// un cambio es una acción humana explícita (aprobar en /trades), que vive en
// app/api/scanner-rules/route.ts — este módulo solo analiza y sugiere.
//
// La señal no es un objetivo de hit rate inventado (eso sería fijar un umbral
// arbitrario sin aprobación, justo lo que el usuario pidió no hacer). Es una
// comparación entre dos números que el propio sistema ya calcula y ya guarda:
// la probabilidad estimada promedio de los planes AUTO (probTouch, planTargets.ts)
// contra la tasa real de acierto de esos mismos planes (paperResults.ts). Si el
// sistema se mostró más confiado de lo que resultó, se propone un umbral más
// estricto; si se mostró más pesimista de lo que resultó, uno menos estricto.
//
// El amortiguamiento (gain) y la muestra mínima son los mismos que ya usa
// lib/prediction.ts para su propia auto-corrección — el precedente que el
// usuario pidió copiar, no un mecanismo nuevo. El único número genuinamente
// nuevo es el tope de puntos por ciclo (PROPOSAL_CAP): 5 puntos sobre una
// escala de 0-100 es un ajuste chico y documentado, no un salto grande.

import type { PaperPlan } from "./paperPlan";
import { sliceResults, CALIBRATION_MIN_SAMPLES } from "./paperResults";
import type { ScannerRules } from "./scannerRules";

/** Mismo damping que lib/prediction.ts (CALIBRATION.gain) — converge, no oscila. */
export const PROPOSAL_GAIN = 0.6;

/** Tope de puntos (escala 0-100) que un solo ciclo puede mover un umbral. */
export const PROPOSAL_CAP = 5;

export type RuleKey = "intradayThreshold" | "swingThreshold";

export interface RuleProposalDraft {
  ruleKey: RuleKey;
  currentValue: number;
  proposedValue: number;
  sampleSize: number;
  actualHitRate: number;
  avgEstimatedProbability: number;
  rationale: string;
}

function avgEstimatedProbability(plans: PaperPlan[]): number | null {
  const withProb = plans.filter(
    (p): p is PaperPlan & { estimatedProbability: number } => p.estimatedProbability != null,
  );
  if (withProb.length === 0) return null;
  return withProb.reduce((s, p) => s + p.estimatedProbability, 0) / withProb.length;
}

function proposeFor(plans: PaperPlan[], ruleKey: RuleKey, currentValue: number): RuleProposalDraft | null {
  const slice = sliceResults(plans, ruleKey);
  if (slice.resolved < CALIBRATION_MIN_SAMPLES || slice.hitRate == null) return null;

  const avgProb = avgEstimatedProbability(plans.filter((p) => p.status === "ganada" || p.status === "perdida"));
  if (avgProb == null) return null;

  const actualHitRate = slice.hitRate;
  // + = el sistema fue más optimista de lo que resultó (sobreconfianza) → más estricto.
  // - = el sistema fue más pesimista de lo que resultó (subconfianza) → menos estricto.
  const deviation = avgProb - actualHitRate;
  const rawShift = deviation * PROPOSAL_GAIN;
  const shift = Math.round(Math.max(-PROPOSAL_CAP, Math.min(PROPOSAL_CAP, rawShift)));
  if (shift === 0) return null;

  const proposedValue = Math.max(0, Math.min(100, currentValue + shift));
  if (proposedValue === currentValue) return null;

  const direction = shift > 0 ? "más estricto" : "menos estricto";
  const confianza = shift > 0 ? "más optimista de lo que resultó" : "más pesimista de lo que resultó";

  return {
    ruleKey, currentValue, proposedValue,
    sampleSize: slice.resolved, actualHitRate, avgEstimatedProbability: avgProb,
    rationale:
      `${slice.resolved} planes AUTO resueltos: probabilidad estimada promedio ${avgProb.toFixed(0)}%, ` +
      `tasa real de acierto ${actualHitRate.toFixed(0)}%. El sistema fue ${confianza} — ` +
      `se propone un umbral ${direction} (${currentValue} → ${proposedValue}).`,
  };
}

/**
 * Analiza los planes AUTO resueltos de cada horizonte y devuelve un draft de
 * propuesta por umbral que muestre una desviación suficiente y con muestra
 * suficiente. Array vacío = nada que proponer todavía (dato insuficiente o
 * el sistema ya está bien calibrado). Pura — no toca el store, no aplica nada.
 */
export function proposeRuleChanges(plans: PaperPlan[], active: ScannerRules): RuleProposalDraft[] {
  const drafts: RuleProposalDraft[] = [];

  const intradayAuto = plans.filter((p) => p.origin === "auto" && p.horizon === "intradia");
  const intraday = proposeFor(intradayAuto, "intradayThreshold", active.intradayThreshold);
  if (intraday) drafts.push(intraday);

  const swingAuto = plans.filter((p) => p.origin === "auto" && p.horizon === "swing");
  const swing = proposeFor(swingAuto, "swingThreshold", active.swingThreshold);
  if (swing) drafts.push(swing);

  return drafts;
}
