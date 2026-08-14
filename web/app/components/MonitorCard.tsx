"use client";

// Tarjeta de monitoreo automático — revisa los planes abiertos (pendiente/activa)
// contra su cotización real y activa/cierra/expira solos (app/api/monitor,
// lib/planMonitor.ts). Corre sola cada 15 min por launchd; este botón es para
// verlo pasar en vivo o forzar una revisión ahora mismo.

import { useCallback, useEffect, useRef, useState } from "react";

type MonitorEvent =
  | { type: "step"; label: string }
  | {
      type: "done";
      checked: number;
      activated: { id: string; ticker: string; entry: number }[];
      closed: { id: string; ticker: string; outcome: string; exit: number }[];
      expired: { id: string; ticker: string }[];
      updatedHighest: number;
      dataIssues: { id: string; ticker: string; reason: string }[];
    }
  | { type: "error"; message: string };

export default function MonitorCard({ onChanged }: { onChanged?: () => void }) {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [result, setResult] = useState<Extract<MonitorEvent, { type: "done" }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const run = useCallback(() => {
    esRef.current?.close();
    setRunning(true);
    setSteps([]);
    setResult(null);
    setError(null);

    const es = new EventSource("/api/monitor");
    esRef.current = es;

    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as MonitorEvent;
      if (data.type === "step") {
        setSteps((s) => [...s, data.label]);
      } else if (data.type === "done") {
        setResult(data);
        setRunning(false);
        es.close();
        if (data.activated.length + data.closed.length + data.expired.length > 0) onChanged?.();
      } else if (data.type === "error") {
        setError(data.message);
        setRunning(false);
        es.close();
      }
    };
    es.onerror = () => {
      setError("Se cortó la conexión con el monitor.");
      setRunning(false);
      es.close();
    };
  }, [onChanged]);

  useEffect(() => () => esRef.current?.close(), []);

  return (
    <div className="card scanner-card">
      <div className="scanner-head">
        <h3>Monitoreo automático</h3>
        <button className="rescan" onClick={run} disabled={running}>
          {running ? "Revisando…" : "Revisar ahora"}
        </button>
      </div>
      <p className="muted">
        Cotiza cada plan abierto (pendiente o activa) contra su contrato real y solo actúa: activa
        cuando estaba pendiente, cierra al tocar objetivo o stop, expira si el contrato ya venció.
        Corre sola cada 15 min en horario de mercado — este botón fuerza una revisión ahora.
      </p>

      {steps.length > 0 && (
        <ul className="scanner-steps">
          {steps.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}

      {error && <div className="error">⚠ {error}</div>}

      {result && (
        <div className="scanner-result">
          <p>
            {result.checked} plan(es) revisado(s) · {result.activated.length} activado(s) ·{" "}
            {result.closed.length} cerrado(s) · {result.expired.length} expirado(s) ·{" "}
            {result.updatedHighest} sin cambio de estado (solo máximo actualizado).
          </p>
          {result.activated.length > 0 && (
            <ul>
              {result.activated.map((a) => <li key={a.id}>{a.ticker} — activado a ${a.entry.toFixed(2)}</li>)}
            </ul>
          )}
          {result.closed.length > 0 && (
            <ul>
              {result.closed.map((c) => (
                <li key={c.id}>{c.ticker} — {c.outcome} a ${c.exit.toFixed(2)}</li>
              ))}
            </ul>
          )}
          {result.expired.length > 0 && (
            <ul>
              {result.expired.map((e) => <li key={e.id}>{e.ticker} — expirado</li>)}
            </ul>
          )}
          {result.dataIssues.length > 0 && (
            <details>
              <summary>{result.dataIssues.length} con falla de datos</summary>
              <ul>
                {result.dataIssues.map((r) => <li key={r.id}>{r.ticker} — {r.reason}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
