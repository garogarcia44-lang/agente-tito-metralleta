// GET /api/monitor — revisa TODOS los planes paper abiertos (pendiente/activa)
// contra su cotización real de ahora mismo, y aplica solo lo que corresponda
// (activar/cerrar/expirar/actualizar máximo) — la pieza que faltaba para que
// "Mis Trades" sea automático de punta a punta, no solo la detección.
//
// La decisión es pura (lib/planMonitor.ts, con tests); esta ruta solo hace el
// I/O: cotizar cada contrato exacto (lib/marketsnack.ts →
// fetchContractsForExpiration, un vencimiento específico — los planes swing
// pueden ser LEAPS a más de un año, fuera de la ventana de fetchOptionChain)
// y aplicar la transición con lib/paperPlanActions.ts — la MISMA lógica que
// usa el clic manual en /trades, así que el resultado es idéntico.
//
// Lo dispara com.tito.monitor-plans.plist cada 15 min en horario de mercado
// (scripts/monitor-plans.mjs), o el botón "Revisar ahora" en /trades.

import { loadPaperPlans, savePaperPlans } from "@/lib/paperPlansStore";
import { fetchContractsForExpiration } from "@/lib/marketsnack";
import { toRow } from "@/lib/compute";
import { evaluatePlan } from "@/lib/planMonitor";
import { updateHighestPrice, type PaperPlan } from "@/lib/paperPlan";
import { applyActivate, applyClose, applyExpire } from "@/lib/paperPlanActions";
import type { Row } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SseEvent {
  type: "step" | "done" | "error";
  [k: string]: unknown;
}
function sse(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: SseEvent) => controller.enqueue(encoder.encode(sse(e)));

      try {
        const { plans } = await loadPaperPlans();
        const open = plans.filter((p) => p.status === "pendiente" || p.status === "activa");
        send({ type: "step", label: `${open.length} plan(es) abierto(s) para revisar.` });

        const activated: { id: string; ticker: string; entry: number }[] = [];
        const closed: { id: string; ticker: string; outcome: string; exit: number }[] = [];
        const expired: { id: string; ticker: string }[] = [];
        const dataIssues: { id: string; ticker: string; reason: string }[] = [];
        let updatedHighest = 0;

        let current: PaperPlan[] = plans;
        const now = new Date();
        // Cache por (ticker, vencimiento) dentro de esta corrida — varios planes
        // pueden compartir el mismo vencimiento, no repetir la misma llamada.
        const chainCache = new Map<string, Promise<Row[]>>();

        for (const plan of open) {
          send({ type: "step", label: `${plan.ticker} (${plan.symbol}): cotizando…` });

          const cacheKey = `${plan.ticker}|${plan.expiration}`;
          if (!chainCache.has(cacheKey)) {
            chainCache.set(
              cacheKey,
              fetchContractsForExpiration(plan.ticker, plan.expiration).then((raw) => raw.map(toRow)),
            );
          }

          let rows: Row[];
          try {
            rows = await chainCache.get(cacheKey)!;
          } catch (err) {
            dataIssues.push({
              id: plan.id, ticker: plan.ticker,
              reason: err instanceof Error ? err.message : "Error al cotizar el vencimiento.",
            });
            continue;
          }

          const row = rows.find((r) => r.optionTicker === plan.symbol) ?? null;
          if (!row || row.price == null) {
            dataIssues.push({
              id: plan.id, ticker: plan.ticker,
              reason: "Contrato no encontrado en ese vencimiento o sin precio disponible.",
            });
            continue;
          }

          const quote = { price: row.price, source: "marketsnack", at: now.toISOString() };
          const action = evaluatePlan(plan, quote, now);
          if (!action) continue;

          if (action.type === "activate") {
            const { plan: updated } = await applyActivate(plan, action.entry, now);
            current = current.map((p) => (p.id === updated.id ? updated : p));
            activated.push({ id: plan.id, ticker: plan.ticker, entry: action.entry.price });
            send({ type: "step", label: `${plan.ticker}: activado a ${action.entry.price}.` });
          } else if (action.type === "close") {
            const { plan: updated } = await applyClose(plan, action.outcome, action.exit, action.reason, now);
            current = current.map((p) => (p.id === updated.id ? updated : p));
            closed.push({ id: plan.id, ticker: plan.ticker, outcome: action.outcome, exit: action.exit.price });
            send({ type: "step", label: `${plan.ticker}: cerrado ${action.outcome} a ${action.exit.price}.` });
          } else if (action.type === "expire") {
            const { plan: updated } = await applyExpire(plan, action.reason, now);
            current = current.map((p) => (p.id === updated.id ? updated : p));
            expired.push({ id: plan.id, ticker: plan.ticker });
            send({ type: "step", label: `${plan.ticker}: expirado.` });
          } else if (action.type === "updateHighest") {
            const updated = updateHighestPrice(plan, action.observed);
            current = current.map((p) => (p.id === updated.id ? updated : p));
            updatedHighest++;
          }
        }

        await savePaperPlans(current);

        send({
          type: "done",
          checked: open.length,
          activated, closed, expired, updatedHighest, dataIssues,
        });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Error inesperado en el monitoreo." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
