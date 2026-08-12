"use client";

import { useState } from "react";
import type { ContractType } from "@/lib/types";
import type { CreatePlanInput, Horizon } from "@/lib/paperPlan";

/** Mismo formato OCC que parsea `parseOcc` en lib/occ.ts, solo que al revés. */
function buildOccSymbol(ticker: string, expiration: string, type: ContractType, strike: number): string {
  const d = new Date(`${expiration}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const cp = type === "call" ? "C" : "P";
  const strikeInt = Math.round(strike * 1000).toString().padStart(8, "0");
  return `${ticker.trim().toUpperCase()}${yy}${mm}${dd}${cp}${strikeInt}`;
}

const EMPTY = {
  ticker: "", contractType: "call" as ContractType, strike: "", expiration: "",
  strategy: "long_call", horizon: "swing" as Horizon,
  trigger: "", target: "", initialStop: "", estimatedProbability: "", contracts: "1",
  notes: "",
};

export default function PaperPlanForm({
  onCreate,
  busy,
}: {
  onCreate: (input: Omit<CreatePlanInput, "id">) => Promise<void>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const symbolPreview =
    f.ticker && f.expiration && f.strike
      ? buildOccSymbol(f.ticker, f.expiration, f.contractType, Number(f.strike))
      : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const strike = Number(f.strike), trigger = Number(f.trigger), target = Number(f.target),
      initialStop = Number(f.initialStop), contracts = Number(f.contracts);
    if (!f.ticker.trim() || !f.expiration || !symbolPreview) {
      setError("Falta ticker, vencimiento o strike.");
      return;
    }
    if (![strike, trigger, target, initialStop, contracts].every(Number.isFinite) || contracts <= 0) {
      setError("Strike, gatillo, objetivo, stop inicial y contratos deben ser números válidos.");
      return;
    }
    await onCreate({
      ticker: f.ticker,
      contractType: f.contractType,
      strike,
      expiration: f.expiration,
      symbol: symbolPreview,
      strategy: f.strategy.trim() || "long_call",
      horizon: f.horizon,
      trigger,
      target,
      initialStop,
      estimatedProbability: f.estimatedProbability ? Number(f.estimatedProbability) : null,
      contracts,
      origin: "manual",
      notes: f.notes.trim() || null,
    });
    setF(EMPTY);
    setOpen(false);
  }

  return (
    <div className="card">
      <div className="risk-head">
        <h2>➕ Nuevo plan paper</h2>
        <button className="rescan" type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Cerrar" : "Crear plan"}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="paperplan-form">
          <div className="paperplan-grid">
            <label className="risk-field">
              <span>Ticker</span>
              <input value={f.ticker} onChange={set("ticker")} placeholder="AAPL" />
            </label>
            <label className="risk-field">
              <span>Tipo</span>
              <select value={f.contractType} onChange={set("contractType")}>
                <option value="call">Call</option>
                <option value="put">Put</option>
              </select>
            </label>
            <label className="risk-field">
              <span>Strike</span>
              <input value={f.strike} onChange={set("strike")} placeholder="230" inputMode="decimal" />
            </label>
            <label className="risk-field">
              <span>Vencimiento</span>
              <input type="date" value={f.expiration} onChange={set("expiration")} />
            </label>
            <label className="risk-field">
              <span>Horizonte</span>
              <select value={f.horizon} onChange={set("horizon")}>
                <option value="intradia">Intradía</option>
                <option value="swing">Swing</option>
              </select>
            </label>
            <label className="risk-field">
              <span>Estrategia</span>
              <input value={f.strategy} onChange={set("strategy")} placeholder="long_call" />
            </label>
            <label className="risk-field">
              <span>Gatillo (prima)</span>
              <input value={f.trigger} onChange={set("trigger")} placeholder="5.00" inputMode="decimal" />
            </label>
            <label className="risk-field">
              <span>Objetivo (prima)</span>
              <input value={f.target} onChange={set("target")} placeholder="8.00" inputMode="decimal" />
            </label>
            <label className="risk-field">
              <span>Stop inicial (prima)</span>
              <input value={f.initialStop} onChange={set("initialStop")} placeholder="3.00" inputMode="decimal" />
            </label>
            <label className="risk-field">
              <span>Probabilidad estimada (%)</span>
              <input value={f.estimatedProbability} onChange={set("estimatedProbability")} placeholder="60" inputMode="decimal" />
            </label>
            <label className="risk-field">
              <span>Contratos (paper)</span>
              <input value={f.contracts} onChange={set("contracts")} placeholder="1" inputMode="numeric" />
            </label>
          </div>

          <label className="risk-field grow">
            <span>Notas (por qué se creó este plan)</span>
            <input value={f.notes} onChange={set("notes")} placeholder="Flujo inusual + GEX en el strike" />
          </label>

          {symbolPreview && <p className="muted">Contrato: <code>{symbolPreview}</code></p>}
          {error && <div className="error">⚠ {error}</div>}

          <button className="rescan" type="submit" disabled={busy}>
            {busy ? "Creando…" : "Crear plan paper"}
          </button>
        </form>
      )}
    </div>
  );
}
