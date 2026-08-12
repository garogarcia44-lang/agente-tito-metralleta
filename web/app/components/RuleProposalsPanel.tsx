"use client";

// Panel del ciclo de mejora controlada — /trades. Nada de esto se aplica solo:
// "Generar propuestas" solo ANALIZA (lib/ruleProposals.ts) y agrega al
// historial; el único botón que cambia un umbral de verdad es "Aprobar", una
// acción humana explícita por cada propuesta.

import { useCallback, useEffect, useState } from "react";

interface RuleProposal {
  id: string;
  ruleKey: "intradayThreshold" | "swingThreshold";
  currentValue: number;
  proposedValue: number;
  sampleSize: number;
  actualHitRate: number;
  avgEstimatedProbability: number;
  rationale: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  decidedAt: string | null;
}

interface ScannerRulesState {
  active: { intradayThreshold: number; swingThreshold: number };
  proposals: RuleProposal[];
}

const RULE_LABEL: Record<RuleProposal["ruleKey"], string> = {
  intradayThreshold: "Umbral intradía",
  swingThreshold: "Umbral swing",
};

export default function RuleProposalsPanel() {
  const [state, setState] = useState<ScannerRulesState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/scanner-rules");
    const data = await res.json();
    setState(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setError(null); setNote(null);
    try {
      const res = await fetch("/api/scanner-rules", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo aplicar la acción.");
      setState(data);
      if (typeof data.created === "number") {
        setNote(data.created > 0 ? `${data.created} propuesta(s) nueva(s).` : "Sin propuestas nuevas — dato insuficiente o el sistema ya está bien calibrado.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (!state) return null;

  const pending = state.proposals.filter((p) => p.status === "pending");
  const decided = state.proposals.filter((p) => p.status !== "pending");

  return (
    <div className="card">
      <div className="scanner-head">
        <h3>Ciclo de mejora</h3>
        <button className="rescan" onClick={() => post({ action: "generate" })} disabled={busy}>
          {busy ? "Analizando…" : "Generar propuestas"}
        </button>
      </div>
      <p className="muted">
        Compara la probabilidad estimada promedio de los planes AUTO resueltos contra su tasa
        real de acierto, y propone ajustar el umbral de score si hay una desviación sostenida
        con muestra suficiente. Nada se aplica solo: cada propuesta se aprueba o se rechaza a mano.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Umbral intradía activo</div>
          <div className="stat-value">{state.active.intradayThreshold}/100</div>
        </div>
        <div className="stat">
          <div className="stat-label">Umbral swing activo</div>
          <div className="stat-value">{state.active.swingThreshold}/100</div>
        </div>
      </div>

      {error && <div className="error">⚠ {error}</div>}
      {note && <div className="muted paperplan-alert-note">{note}</div>}

      {pending.length > 0 && (
        <div className="scanner-result">
          <p style={{ fontWeight: 600 }}>{pending.length} propuesta(s) pendiente(s)</p>
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {pending.map((p) => (
              <li key={p.id} className="stat" style={{ background: "var(--panel)" }}>
                <div className="stat-label">{RULE_LABEL[p.ruleKey]}</div>
                <p style={{ margin: "4px 0 8px", fontSize: 13 }}>{p.rationale}</p>
                <div className="paperplan-actions">
                  <button className="rescan" disabled={busy} onClick={() => post({ action: "approve", id: p.id })}>
                    ✅ Aprobar ({p.currentValue} → {p.proposedValue})
                  </button>
                  <button className="rescan" disabled={busy} onClick={() => post({ action: "reject", id: p.id })}>
                    ✕ Rechazar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {decided.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="muted">{decided.length} propuesta(s) decidida(s)</summary>
          <ul style={{ marginTop: 8 }}>
            {decided.map((p) => (
              <li key={p.id}>
                {RULE_LABEL[p.ruleKey]}: {p.currentValue} → {p.proposedValue} —{" "}
                {p.status === "approved" ? "✅ aprobada" : "✕ rechazada"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
