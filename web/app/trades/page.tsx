"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NavTabs from "@/app/components/NavTabs";
import PaperPlanForm from "@/app/components/PaperPlanForm";
import PaperPlansTable from "@/app/components/PaperPlansTable";
import type { CreatePlanInput, PaperPlan } from "@/lib/paperPlan";

interface ApiResponse {
  plans: PaperPlan[];
  alert?: { sent: boolean; duplicate: boolean; reason?: string };
}

type ScanEvent =
  | { type: "step"; label: string }
  | {
      type: "done";
      created: { id: string; ticker: string; symbol: string; score: number }[];
      rejectedByScore: { ticker: string; symbol: string; score: number }[];
      rejectedByGuard: { ticker: string; symbol: string; reason: string }[];
      dataIssues: { ticker: string; reason: string }[];
      meta: { scanned: number; candidates: number; analyzed: number; scoreThreshold: number };
    }
  | { type: "error"; message: string };

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

  const [scanning, setScanning] = useState(false);
  const [scanSteps, setScanSteps] = useState<string[]>([]);
  const [scanResult, setScanResult] = useState<Extract<ScanEvent, { type: "done" }> | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanEsRef = useRef<EventSource | null>(null);

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

  const runScan = useCallback(() => {
    scanEsRef.current?.close();
    setScanning(true);
    setScanSteps([]);
    setScanResult(null);
    setScanError(null);

    const es = new EventSource("/api/scan/intraday");
    scanEsRef.current = es;

    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as ScanEvent;
      if (data.type === "step") {
        setScanSteps((s) => [...s, data.label]);
      } else if (data.type === "done") {
        setScanResult(data);
        setScanning(false);
        es.close();
        if (data.created.length > 0) load();
      } else if (data.type === "error") {
        setScanError(data.message);
        setScanning(false);
        es.close();
      }
    };
    es.onerror = () => {
      setScanError("Se cortó la conexión con el escáner.");
      setScanning(false);
      es.close();
    };
  }, [load]);

  useEffect(() => () => scanEsRef.current?.close(), []);

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

        <div className="card scanner-card">
          <div className="scanner-head">
            <h3>Escanear oportunidades (intradía)</h3>
            <button className="rescan" onClick={runScan} disabled={scanning}>
              {scanning ? "Escaneando…" : "Escanear ahora"}
            </button>
          </div>
          <p className="muted">
            Escanea el flujo del mercado, mide confluencia (flujo + GEX + niveles reales +
            liquidez + frescura) y crea planes AUTO en paper trading solo si pasa el umbral y
            no contradice ni duplica un plan ya vigente. Bajo demanda por ahora — no corre solo.
          </p>

          {scanSteps.length > 0 && (
            <ul className="scanner-steps">
              {scanSteps.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}

          {scanError && <div className="error">⚠ {scanError}</div>}

          {scanResult && (
            <div className="scanner-result">
              <p>
                {scanResult.created.length > 0
                  ? `✅ ${scanResult.created.length} plan(es) AUTO creado(s).`
                  : "Sin oportunidades que pasaran el umbral esta vez."}
                {" "}Analizados {scanResult.meta.analyzed} de {scanResult.meta.candidates} tickers
                candidatos (umbral {scanResult.meta.scoreThreshold}/100).
              </p>
              {scanResult.created.length > 0 && (
                <ul>
                  {scanResult.created.map((c) => (
                    <li key={c.id}>{c.symbol} — score {c.score}/100</li>
                  ))}
                </ul>
              )}
              {scanResult.rejectedByScore.length > 0 && (
                <details>
                  <summary>{scanResult.rejectedByScore.length} descartado(s) por score bajo</summary>
                  <ul>
                    {scanResult.rejectedByScore.map((r, i) => (
                      <li key={i}>{r.symbol} — {r.score}/100</li>
                    ))}
                  </ul>
                </details>
              )}
              {scanResult.rejectedByGuard.length > 0 && (
                <details>
                  <summary>{scanResult.rejectedByGuard.length} descartado(s) por duplicado/contradicción</summary>
                  <ul>
                    {scanResult.rejectedByGuard.map((r, i) => (
                      <li key={i}>{r.symbol} — {r.reason}</li>
                    ))}
                  </ul>
                </details>
              )}
              {scanResult.dataIssues.length > 0 && (
                <details>
                  <summary>{scanResult.dataIssues.length} con falla de datos</summary>
                  <ul>
                    {scanResult.dataIssues.map((r, i) => (
                      <li key={i}>{r.ticker} — {r.reason}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

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
