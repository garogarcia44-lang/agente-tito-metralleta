"use client";

// Panel de medición de resultados de "Mis Trades" — hit rate, P&L acumulado y
// calibración de las probabilidades estimadas. Todo se calcula en el navegador
// a partir de los planes que /trades ya cargó; no pega al servidor de nuevo.

import { useMemo } from "react";
import { buildPaperResults, CALIBRATION_MIN_SAMPLES, type ResultsSlice } from "@/lib/paperResults";
import type { PaperPlan } from "@/lib/paperPlan";

function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
function fmtPct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(0)}%`;
}

function SliceRow({ slice }: { slice: ResultsSlice }) {
  return (
    <tr>
      <td>{slice.label}</td>
      <td className="num">{slice.total}</td>
      <td className="num">{slice.resolved}</td>
      <td className="num">{fmtPct(slice.hitRate)}</td>
      <td className="num">{fmtMoney(slice.totalPnl)}</td>
      <td className="num">{slice.avgPnl == null ? "—" : fmtMoney(slice.avgPnl)}</td>
    </tr>
  );
}

export default function PaperResultsPanel({ plans }: { plans: PaperPlan[] }) {
  const report = useMemo(() => buildPaperResults(plans), [plans]);
  const { overall } = report;

  if (overall.total === 0) return null;

  return (
    <div className="card">
      <h3>Resultados</h3>
      <p className="muted">
        Medido sobre {overall.total} plan(es) — {overall.open} en juego, {overall.neverActivated} nunca
        se activaron, {overall.timedOut} expiraron sin resolver.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Hit rate</div>
          <div className="stat-value">{fmtPct(overall.hitRate)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Resueltos</div>
          <div className="stat-value">{overall.resolved}</div>
        </div>
        <div className="stat">
          <div className="stat-label">P&L acumulado</div>
          <div className="stat-value">{fmtMoney(overall.totalPnl)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">P&L promedio</div>
          <div className="stat-value">{overall.avgPnl == null ? "—" : fmtMoney(overall.avgPnl)}</div>
        </div>
      </div>

      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <table className="ideas-table">
          <thead>
            <tr>
              <th>Corte</th>
              <th className="num">Total</th>
              <th className="num">Resueltos</th>
              <th className="num">Hit rate</th>
              <th className="num">P&L</th>
              <th className="num">P&L prom.</th>
            </tr>
          </thead>
          <tbody>
            <SliceRow slice={report.byHorizon.intradia} />
            <SliceRow slice={report.byHorizon.swing} />
            <SliceRow slice={report.byOrigin.auto} />
            <SliceRow slice={report.byOrigin.manual} />
          </tbody>
        </table>
      </div>

      {report.calibration.some((b) => b.n > 0) && (
        <div style={{ overflowX: "auto", marginTop: 16 }}>
          <p className="muted" style={{ margin: "0 0 8px" }}>
            Calibración: de los planes resueltos con probabilidad estimada, ¿la tasa real de
            acierto se parece a lo que decía el número? Buckets con menos de{" "}
            {CALIBRATION_MIN_SAMPLES} muestras no son significativos todavía.
          </p>
          <table className="ideas-table">
            <thead>
              <tr>
                <th>Probabilidad estimada</th>
                <th className="num">Planes</th>
                <th className="num">Tasa real</th>
                <th>Muestra</th>
              </tr>
            </thead>
            <tbody>
              {report.calibration.map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td className="num">{b.n}</td>
                  <td className="num">{fmtPct(b.actualRate)}</td>
                  <td>{b.n === 0 ? "—" : b.sufficientSample ? "suficiente" : "insuficiente"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
