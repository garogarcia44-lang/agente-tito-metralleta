"use client";

import { useCallback, useEffect, useState } from "react";
import NavTabs from "@/app/components/NavTabs";
import PaperPlanForm from "@/app/components/PaperPlanForm";
import PaperPlansTable from "@/app/components/PaperPlansTable";
import type { CreatePlanInput, PaperPlan } from "@/lib/paperPlan";

async function callApi(body: Record<string, unknown>): Promise<PaperPlan[]> {
  const res = await fetch("/api/paperplans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "No se pudo aplicar la acción.");
  return data.plans as PaperPlan[];
}

export default function TradesPage() {
  const [plans, setPlans] = useState<PaperPlan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/paperplans");
    const data = await res.json();
    setPlans(data.plans ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      const updated = await callApi(body);
      setPlans(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }, []);

  const nowIso = () => new Date().toISOString();

  return (
    <main className="ideas-page">
      <div className="hb">
        <div className="hb-brand">
          <div className="hb-logo">T</div>
          <div className="hb-name">Tito Metralleta</div>
          <div className="hb-chip">Mis Trades · paper</div>
        </div>
        <NavTabs />
      </div>

      <div className="ideas-body">
        <div className="paper-banner">
          ⚠️ TITO METRALLETA — SIMULACIÓN / PAPER TRADING
          <p>
            Nada de lo que hay aquí es una orden ni asesoría financiera. Tito Metralleta no opera
            en tu bróker. Si decides entrar de verdad, lo haces manualmente y bajo tu propia
            responsabilidad.
          </p>
        </div>

        <PaperPlanForm
          busy={busy}
          onCreate={async (input: Omit<CreatePlanInput, "id">) => run({ action: "create", input })}
        />

        {error && <div className="error">⚠ {error}</div>}

        {plans === null ? (
          <div className="card wheel-empty">Cargando…</div>
        ) : (
          <PaperPlansTable
            plans={plans}
            onActivate={(id, price) =>
              run({ action: "activate", id, entry: { price, source: "manual", at: nowIso() } })
            }
            onRaiseStop={(id, value) => run({ action: "raiseStop", id, value, reason: "Ajuste manual." })}
            onClose={(id, outcome, price) =>
              run({
                action: "close",
                id,
                outcome,
                exit: { price, at: nowIso() },
                reason: outcome === "ganada" ? "Llegó al objetivo." : "Se activó el stop.",
              })
            }
            onExpire={(id) => run({ action: "expire", id, reason: "Venció sin resolver." })}
            onEditContracts={(id, contracts) => run({ action: "editContracts", id, contracts })}
            onDelete={(id) =>
              fetch(`/api/paperplans?id=${id}`, { method: "DELETE" })
                .then((r) => r.json())
                .then((d) => setPlans(d.plans))
            }
          />
        )}
      </div>
    </main>
  );
}
