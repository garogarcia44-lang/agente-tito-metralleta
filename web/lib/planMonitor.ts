// Motor de decisión PURO del monitoreo automático de planes paper abiertos
// (pendiente/activa) — sin I/O. Compara la prima real observada AHORA contra
// trigger/target/dynamicStop que ya calculó lib/planTargets.ts al crear el
// plan; nunca inventa un número nuevo. El I/O (cotizar el contrato, aplicar
// la acción, guardar, avisar) vive en app/api/monitor/route.ts.
//
// Semántica de "pendiente" → "activa": `trigger` es la prima que tenía el
// contrato en el momento en que el escáner detectó la señal (auditoría de
// contexto, ver lib/planTargets.ts) — no es una condición de cruce con
// dirección propia que el plan deba esperar a cumplir. Por eso la activación
// automática ocurre en el PRIMER chequeo del monitor después de creado el
// plan, con la prima real observada en ese momento como precio de entrada.
// Es la versión automática de lo que antes hacía Jorge a mano: ver el plan
// recién creado y activarlo con el precio del momento.

import { daysToExpiration } from "./occ";
import type { PaperPlan, Quote } from "./paperPlan";

export type MonitorAction =
  | { type: "activate"; entry: Quote }
  | { type: "close"; outcome: "ganada" | "perdida"; exit: { price: number; at: string }; reason: string }
  | { type: "expire"; reason: string }
  | { type: "updateHighest"; observed: Quote };

/**
 * Decide qué acción (si alguna) corresponde para un plan `pendiente`/`activa`
 * dada una cotización real de su contrato. `null` = nada que hacer todavía.
 * Ignora planes en estados terminales (ganada/perdida/expirada) — el llamador
 * ya debería filtrarlos, pero es seguro pasarlos igual.
 */
export function evaluatePlan(plan: PaperPlan, quote: Quote, now: Date): MonitorAction | null {
  if (plan.status !== "pendiente" && plan.status !== "activa") return null;

  const dte = daysToExpiration(plan.expiration, now);
  if (dte < 0) {
    return { type: "expire", reason: "El contrato venció sin resolver (monitoreo automático)." };
  }

  if (plan.status === "pendiente") {
    return { type: "activate", entry: quote };
  }

  // activa: ¿tocó objetivo o stop?
  if (quote.price >= plan.target) {
    return {
      type: "close",
      outcome: "ganada",
      exit: { price: quote.price, at: quote.at },
      reason: `Objetivo alcanzado: prima ${quote.price} ≥ objetivo ${plan.target} (monitoreo automático).`,
    };
  }
  if (quote.price <= plan.dynamicStop) {
    return {
      type: "close",
      outcome: "perdida",
      exit: { price: quote.price, at: quote.at },
      reason: `Stop alcanzado: prima ${quote.price} ≤ stop ${plan.dynamicStop} (monitoreo automático).`,
    };
  }
  return { type: "updateHighest", observed: quote };
}
