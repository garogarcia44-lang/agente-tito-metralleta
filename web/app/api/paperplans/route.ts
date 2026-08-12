// /api/paperplans — "Mis Trades", SIMULACIÓN / PAPER TRADING.
//
//   GET                     → { plans }
//   POST { action, ... }    → aplica una acción (crear/activar/subir stop/cerrar/expirar/
//                              editar contratos) y devuelve { plans } ya actualizado
//   DELETE ?id=             → borra un plan (limpieza manual, Fase A)
//
// Fase A: los planes se crean a mano desde la UI. No hay detección automática ni
// monitoreo de cotizaciones en vivo todavía — eso es una fase futura y se pide
// aprobada aparte. Esta ruta solo orquesta I/O; toda la máquina de estados y el
// cálculo de P&L viven en `lib/paperPlan.ts`, puro y testeado.

import { randomUUID } from "crypto";
import {
  InvalidPlanTransitionError,
  activatePlan,
  closePlan,
  createPaperPlan,
  expirePlan,
  raiseDynamicStop,
  updateHighestPrice,
  type CreatePlanInput,
  type PaperPlan,
  type Quote,
} from "@/lib/paperPlan";
import { loadPaperPlans, savePaperPlans } from "@/lib/paperPlansStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { plans } = await loadPaperPlans();
  return Response.json({ plans });
}

function findPlan(plans: PaperPlan[], id: unknown): PaperPlan | null {
  if (typeof id !== "string") return null;
  return plans.find((p) => p.id === id) ?? null;
}

function readQuote(raw: unknown): Quote | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  if (typeof q.price !== "number" || typeof q.source !== "string" || typeof q.at !== "string") {
    return null;
  }
  return { price: q.price, source: q.source, at: q.at };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const { plans } = await loadPaperPlans();
  const now = new Date();

  try {
    if (body.action === "create") {
      const input = body.input as Partial<CreatePlanInput> | undefined;
      if (
        !input ||
        typeof input.ticker !== "string" ||
        (input.contractType !== "call" && input.contractType !== "put") ||
        typeof input.strike !== "number" ||
        typeof input.expiration !== "string" ||
        typeof input.symbol !== "string" ||
        typeof input.strategy !== "string" ||
        (input.horizon !== "intradia" && input.horizon !== "swing") ||
        typeof input.trigger !== "number" ||
        typeof input.target !== "number" ||
        typeof input.initialStop !== "number" ||
        typeof input.contracts !== "number"
      ) {
        return Response.json({ error: "Faltan campos obligatorios del plan." }, { status: 400 });
      }
      const plan = createPaperPlan({ ...input, id: randomUUID() } as CreatePlanInput, now);
      const saved = await savePaperPlans([...plans, plan]);
      return Response.json({ plans: saved.plans });
    }

    const plan = findPlan(plans, body.id);
    if (!plan) return Response.json({ error: "Plan no encontrado." }, { status: 404 });
    const others = plans.filter((p) => p.id !== plan.id);

    if (body.action === "activate") {
      const entry = readQuote(body.entry);
      if (!entry) return Response.json({ error: "Cotización de entrada inválida." }, { status: 400 });
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      const updated = activatePlan(plan, entry, now, reason);
      const saved = await savePaperPlans([...others, updated]);
      return Response.json({ plans: saved.plans });
    }

    if (body.action === "updateHighest") {
      const observed = readQuote(body.observed);
      if (!observed) return Response.json({ error: "Cotización inválida." }, { status: 400 });
      const updated = updateHighestPrice(plan, observed);
      const saved = await savePaperPlans([...others, updated]);
      return Response.json({ plans: saved.plans });
    }

    if (body.action === "raiseStop") {
      if (typeof body.value !== "number" || typeof body.reason !== "string") {
        return Response.json({ error: "Faltan value o reason." }, { status: 400 });
      }
      const { plan: updated, applied } = raiseDynamicStop(plan, body.value, body.reason, now);
      if (!applied) {
        return Response.json(
          { error: "El nuevo stop debe ser mayor al actual, y el plan debe estar activa." },
          { status: 400 },
        );
      }
      const saved = await savePaperPlans([...others, updated]);
      return Response.json({ plans: saved.plans });
    }

    if (body.action === "close") {
      if (
        (body.outcome !== "ganada" && body.outcome !== "perdida") ||
        typeof body.reason !== "string"
      ) {
        return Response.json({ error: "Faltan outcome o reason." }, { status: 400 });
      }
      const exit = body.exit as { price?: unknown; at?: unknown } | undefined;
      if (!exit || typeof exit.price !== "number" || typeof exit.at !== "string") {
        return Response.json({ error: "Falta el precio/hora de salida." }, { status: 400 });
      }
      const updated = closePlan(
        plan,
        body.outcome,
        { price: exit.price, at: exit.at },
        body.reason,
        now,
      );
      const saved = await savePaperPlans([...others, updated]);
      return Response.json({ plans: saved.plans });
    }

    if (body.action === "expire") {
      if (typeof body.reason !== "string") {
        return Response.json({ error: "Falta reason." }, { status: 400 });
      }
      const updated = expirePlan(plan, body.reason, now);
      const saved = await savePaperPlans([...others, updated]);
      return Response.json({ plans: saved.plans });
    }

    if (body.action === "editContracts") {
      if (typeof body.contracts !== "number" || body.contracts <= 0) {
        return Response.json({ error: "contracts debe ser un número positivo." }, { status: 400 });
      }
      const updated: PaperPlan = { ...plan, contracts: body.contracts };
      const saved = await savePaperPlans([...others, updated]);
      return Response.json({ plans: saved.plans });
    }

    return Response.json({ error: "Acción desconocida." }, { status: 400 });
  } catch (err) {
    if (err instanceof InvalidPlanTransitionError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Falta id." }, { status: 400 });
  const { plans } = await loadPaperPlans();
  const saved = await savePaperPlans(plans.filter((p) => p.id !== id));
  return Response.json({ plans: saved.plans });
}
