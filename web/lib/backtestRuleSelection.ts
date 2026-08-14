// Selección automática de umbral a partir del backtest histórico (lib/backtest.ts).
//
// Distinto de lib/ruleProposals.ts (que compara la probabilidad estimada de los
// planes AUTO ya vividos en paper trading contra su resultado real, y siempre
// requiere aprobación humana): esto barre directamente los umbrales candidatos
// contra TODO el flujo histórico real ya guardado y elige, sin pedir permiso,
// el más alto que cumple una muestra mínima y un acierto mínimo — Jorge
// autorizó explícitamente saltar la aprobación SOLO para este camino semanal
// ("los del backtest hazlo automatico para haci no tenga que esperar mi
// autorizacion", 2026-08-14). El ciclo de mejora manual de ruleProposals.ts
// sigue intacto y sigue pidiendo aprobación como siempre.
//
// Pura — sin I/O. Quien la usa (app/api/backtest/route.ts) es quien lee/escribe
// data/scanner-rules.json y deja el rastro de auditoría.

import type { ThresholdBucket } from "./backtest";
import type { RuleKey } from "./ruleProposals";

/**
 * Mínimo de eventos resueltos (ganó o perdió, sin contar timeouts) para
 * confiar en el hit rate de un umbral. El barrido real del 2026-08-14 mostraba
 * muestras de 73/35/18/4/1 resueltos en los umbrales 66-90 — precisamente la
 * zona que el ajuste manual de swingThreshold evitó por insuficiente para no
 * sobreajustar a un puñado de eventos (ver el comentario de swingThreshold en
 * scannerRules.ts). 30 deja pasar umbrales con muestra parecida a la que sí se
 * usó entonces (65 → 122 resueltos) sin exigir tanto que nunca se active.
 */
export const MIN_RESOLVED_SAMPLE = 30;

/**
 * Acierto mínimo exigido, en puntos porcentuales por ENCIMA de 50% (azar). El
 * ajuste manual de swingThreshold se apoyó en 63.1% (z≈2.8, p≈0.003) — muy por
 * encima de esta barra. Se deja más baja (8 puntos) a propósito: esto filtra
 * ruido evidente semana a semana sin exigir la misma fuerza estadística que un
 * ajuste puntual revisado por Jorge.
 */
export const MIN_EDGE_OVER_BASELINE = 8;

export interface AutoSelection {
  ruleKey: RuleKey;
  currentValue: number;
  selectedValue: number;
  bucket: ThresholdBucket;
  rationale: string;
}

/**
 * Del barrido de umbrales, el MÁS ALTO que cumple ambos mínimos — no el de
 * mejor acierto puntual (eso premiaría el umbral con menos muestra, casi
 * siempre el más ruidoso). Umbrales más altos son más selectivos: preferirlos
 * cuando son confiables reduce falsos positivos sin inventar un número nuevo.
 */
function pickThreshold(buckets: ThresholdBucket[]): ThresholdBucket | null {
  const sorted = [...buckets].sort((a, b) => b.threshold - a.threshold);
  for (const bucket of sorted) {
    const resolved = bucket.wins + bucket.losses;
    if (resolved >= MIN_RESOLVED_SAMPLE && bucket.hitRate != null && bucket.hitRate - 50 >= MIN_EDGE_OVER_BASELINE) {
      return bucket;
    }
  }
  return null;
}

/**
 * `null` si ningún umbral del barrido es confiable todavía, o si el más alto
 * confiable ya es el valor activo (nada que cambiar).
 */
export function selectRule(ruleKey: RuleKey, currentValue: number, buckets: ThresholdBucket[]): AutoSelection | null {
  const picked = pickThreshold(buckets);
  if (!picked || picked.threshold === currentValue) return null;

  const resolved = picked.wins + picked.losses;
  return {
    ruleKey,
    currentValue,
    selectedValue: picked.threshold,
    bucket: picked,
    rationale:
      `Backtest semanal automático: con score >= ${picked.threshold} hubo ${resolved} candidatos ` +
      `resueltos (mínimo exigido ${MIN_RESOLVED_SAMPLE}) y ${picked.hitRate!.toFixed(1)}% de acierto ` +
      `(mínimo exigido ${50 + MIN_EDGE_OVER_BASELINE}%). Umbral ${currentValue} → ${picked.threshold}.`,
  };
}
