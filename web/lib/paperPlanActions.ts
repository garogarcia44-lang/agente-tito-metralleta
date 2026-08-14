// Orquesta una transición de plan de punta a punta: aplicar la máquina de
// estados (lib/paperPlan.ts, pura) → capturar el diario de noticias
// (lib/tradeJournal.ts) → avisar por Telegram (lib/paperAlertSender.ts).
// Existe para que app/api/paperplans/route.ts (manual, un humano hace clic) y
// app/api/monitor/route.ts (automático, ver lib/planMonitor.ts) apliquen
// EXACTAMENTE la misma lógica — ninguno reimplementa la otra mitad.

import { activatePlan, closePlan, expirePlan, type PaperPlan, type Quote } from "./paperPlan";
import { captureNewsSnapshot } from "./tradeJournal";
import { sendPaperAlertOnce, type SendPaperAlertResult } from "./paperAlertSender";

export interface PlanActionResult {
  plan: PaperPlan;
  alert: SendPaperAlertResult;
}

export async function applyActivate(
  plan: PaperPlan,
  entry: Quote,
  now: Date,
  reason?: string,
): Promise<PlanActionResult> {
  const activated = activatePlan(plan, entry, now, reason);
  const updated = { ...activated, newsAtEntry: await captureNewsSnapshot(activated.ticker) };
  const alert = await sendPaperAlertOnce({
    plan: updated, event: "activated", observedPrice: entry.price, observedAt: entry.at,
  });
  return { plan: updated, alert };
}

export async function applyClose(
  plan: PaperPlan,
  outcome: "ganada" | "perdida",
  exit: { price: number; at: string },
  reason: string,
  now: Date,
): Promise<PlanActionResult> {
  const closed = closePlan(plan, outcome, exit, reason, now);
  const updated = { ...closed, newsAtExit: await captureNewsSnapshot(closed.ticker) };
  const alert = await sendPaperAlertOnce({
    plan: updated, event: outcome === "ganada" ? "target_hit" : "stop_hit",
    observedPrice: exit.price, observedAt: exit.at,
  });
  return { plan: updated, alert };
}

export async function applyExpire(plan: PaperPlan, reason: string, now: Date): Promise<PlanActionResult> {
  const expired = expirePlan(plan, reason, now);
  const updated = { ...expired, newsAtExit: await captureNewsSnapshot(expired.ticker) };
  const alert = await sendPaperAlertOnce({ plan: updated, event: "expired" });
  return { plan: updated, alert };
}
