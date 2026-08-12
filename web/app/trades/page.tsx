"use client";

import { useCallback, useEffect, useState } from "react";
import NavTabs from "@/app/components/NavTabs";
import OpportunityScanCard from "@/app/components/OpportunityScanCard";
import PaperPlanForm from "@/app/components/PaperPlanForm";
import PaperPlansTable from "@/app/components/PaperPlansTable";
import type { CreatePlanInput, PaperPlan } from "@/lib/paperPlan";

interface ApiResponse {
  plans: PaperPlan[];
  alert?: { sent: boolean; duplicate: boolean; reason?: string };
}

async function callApi(body: Record<string, unknown>): Promise<ApiResponse> {
  const res = await fetch("/api/paperplans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "No se pudo aplicar la acción.");
  return data as ApiResponse;
}

export default function TradesPage() {
  const [plans, setPlans] = useState<PaperPlan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alertNote, setAlertNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/paperplans");
    const data = await res.json();
    setPlans(data.plans ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setError(null); setAlertNote(null);
    try {
      const { plans: updated, alert } = await callApi(body);
      setPlans(updated);
      if (alert) {
        setAlertNote(
          alert.sent
            ? "✅ Alerta enviada por Telegram."
            : alert.duplicate
              ? null // ya se había mandado, no hace falta avisar de nuevo
              : `⚠️ No se pudo avisar por Telegram: ${alert.reason ?? "motivo desconocido"}`,
        );
      }
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

        <OpportunityScanCard
          title="Escanear oportunidades (intradía)"
          description="Escanea el flujo de hoy, mide confluencia (flujo + GEX + niveles reales + liquidez + frescura) y crea planes AUTO en paper trading solo si pasa el umbral y no contradice ni duplica un plan ya vigente. Bajo demanda por ahora — no corre solo."
          endpoint="/api/scan/intraday"
          onCreated={load}
        />

        <OpportunityScanCard
          title="Escanear oportunidades (swing)"
          description="Escanea 5 días de flujo buscando tesis que se sostienen en el tiempo (varios prints en la misma dirección, no un solo trade), con contratos de más días al vencimiento. Mismas garantías: paper trading, bajo demanda, no corre solo."
          endpoint="/api/scan/swing"
          onCreated={load}
        />

        <PaperPlanForm
          busy={busy}
          onCreate={async (input: Omit<CreatePlanInput, "id">) => run({ action: "create", input })}
        />

        {error && <div className="error">⚠ {error}</div>}
        {alertNote && <div className="muted paperplan-alert-note">{alertNote}</div>}

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
