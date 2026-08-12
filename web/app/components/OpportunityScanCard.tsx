"use client";

// Tarjeta de escaneo de oportunidades (Fase C) — un solo componente para
// intradía y swing, parametrizado por endpoint. Ambos SSE devuelven la misma
// forma de evento (lib/intradayScore.ts / lib/swingScore.ts solo cambian el
// sub-score, no la forma del resultado).

import { useCallback, useEffect, useRef, useState } from "react";

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

export interface OpportunityScanCardProps {
  title: string;
  description: string;
  endpoint: string;
  onCreated?: () => void;
}

export default function OpportunityScanCard({ title, description, endpoint, onCreated }: OpportunityScanCardProps) {
  const [scanning, setScanning] = useState(false);
  const [scanSteps, setScanSteps] = useState<string[]>([]);
  const [scanResult, setScanResult] = useState<Extract<ScanEvent, { type: "done" }> | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const runScan = useCallback(() => {
    esRef.current?.close();
    setScanning(true);
    setScanSteps([]);
    setScanResult(null);
    setScanError(null);

    const es = new EventSource(endpoint);
    esRef.current = es;

    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as ScanEvent;
      if (data.type === "step") {
        setScanSteps((s) => [...s, data.label]);
      } else if (data.type === "done") {
        setScanResult(data);
        setScanning(false);
        es.close();
        if (data.created.length > 0) onCreated?.();
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
  }, [endpoint, onCreated]);

  useEffect(() => () => esRef.current?.close(), []);

  return (
    <div className="card scanner-card">
      <div className="scanner-head">
        <h3>{title}</h3>
        <button className="rescan" onClick={runScan} disabled={scanning}>
          {scanning ? "Escaneando…" : "Escanear ahora"}
        </button>
      </div>
      <p className="muted">{description}</p>

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
  );
}
