// Plantilla de las alertas de "Mis Trades" — SIMULACIÓN / PAPER TRADING.
//
// Puro: construye el texto exacto del mensaje (formato pedido: encabezado fijo,
// campos del plan, disclaimer fijo al final). El envío real (Twilio) vive en
// `whatsapp.ts`; el registro/dedupe vive en `alertLogStore.ts`. Este archivo no
// hace I/O y está cubierto por tests.

import type { PaperPlan } from "./paperPlan";

export type AlertEvent =
  | "created"
  | "activated"
  | "stop_raised"
  | "target_hit"
  | "stop_hit"
  | "expired"
  | "data_issue";

const EVENT_TITLE: Record<AlertEvent, string> = {
  created: "Nuevo plan creado",
  activated: "Gatillo activado",
  stop_raised: "El stop dinámico subió",
  target_hit: "Objetivo alcanzado",
  stop_hit: "Se activó el stop",
  expired: "El plan expiró",
  data_issue: "Falla o retraso de datos",
};

export interface AlertContext {
  plan: PaperPlan;
  event: AlertEvent;
  /** Precio observado en el momento del evento (prima), si aplica. */
  observedPrice?: number | null;
  observedAt?: string | null;
  /** Factores principales de la señal, en texto llano — lista corta. */
  factors?: string[];
  /** Solo para `data_issue`: qué falló. */
  note?: string | null;
}

const HEADER = "⚠️ TITO METRALLETA — SIMULACIÓN / PAPER TRADING";
const FOOTER =
  "Esto no es una orden ni asesoría financiera. Tito Metralleta no opera en tu bróker. " +
  "Si decides entrar, debes hacerlo manualmente y bajo tu propia responsabilidad.";

/**
 * Identificador único y determinista de la alerta — mismo evento + mismo plan +
 * mismo valor relevante del evento (ej. el nuevo stop) siempre da el mismo id, así
 * `alertLogStore` puede deduplicar sin depender de un timestamp.
 */
export function alertId(ctx: AlertContext): string {
  const { plan, event } = ctx;
  if (event === "stop_raised") return `${plan.id}:${event}:${plan.dynamicStop}`;
  return `${plan.id}:${event}`;
}

function fmt(n: number | null | undefined): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export interface BuiltAlert {
  id: string;
  event: AlertEvent;
  planId: string;
  text: string;
}

export function buildAlertMessage(ctx: AlertContext): BuiltAlert {
  const { plan, event } = ctx;
  const contractLabel = `${plan.ticker} $${plan.strike.toFixed(2)}${plan.contractType === "call" ? "C" : "P"}`;
  const id = alertId(ctx);

  const lines = [
    HEADER,
    EVENT_TITLE[event],
    "",
    `Ticker y contrato: ${contractLabel}`,
    `Call o put: ${plan.contractType === "call" ? "Call" : "Put"}`,
    `Strike y vencimiento: $${plan.strike.toFixed(2)} · vence ${plan.expiration}`,
    `Tipo de oportunidad: ${plan.horizon === "intradia" ? "Intradía" : "Swing"}`,
    `Estado actual: ${plan.status}`,
    `Precio observado y hora: ${fmt(ctx.observedPrice)} · ${fmtWhen(ctx.observedAt)}`,
    `Gatillo: ${fmt(plan.trigger)}`,
    `Objetivo: ${fmt(plan.target)}`,
    `Stop: ${fmt(plan.dynamicStop)}`,
    `Probabilidad estimada: ${plan.estimatedProbability != null ? `${plan.estimatedProbability}%` : "—"}`,
  ];

  if (event === "data_issue" && ctx.note) {
    lines.push(`Motivo: ${ctx.note}`);
  }

  lines.push(
    `Factores principales: ${ctx.factors && ctx.factors.length > 0 ? ctx.factors.join(" · ") : plan.notes ?? "—"}`,
  );
  lines.push(`Identificador de la alerta: ${id}`);
  lines.push("");
  lines.push(FOOTER);

  return { id, event, planId: plan.id, text: lines.join("\n") };
}
