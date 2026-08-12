"use client";

import { useState } from "react";
import { planPnl, type PaperPlan, type PlanStatus } from "@/lib/paperPlan";

const STATUS_CHIP: Record<PlanStatus, string> = {
  pendiente: "chip-neutral",
  activa: "chip-hot",
  ganada: "chip-ask",
  perdida: "chip-bid",
  expirada: "chip-neutral",
};

const STATUS_LABEL: Record<PlanStatus, string> = {
  pendiente: "Pendiente",
  activa: "Activa",
  ganada: "Ganada",
  perdida: "Perdida",
  expirada: "Expirada",
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const px = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function nowIso(): string {
  return new Date().toISOString();
}

export default function PaperPlansTable({
  plans,
  onActivate,
  onRaiseStop,
  onClose,
  onExpire,
  onEditContracts,
  onDelete,
}: {
  plans: PaperPlan[];
  onActivate: (id: string, price: number) => Promise<void>;
  onRaiseStop: (id: string, value: number) => Promise<void>;
  onClose: (id: string, outcome: "ganada" | "perdida", price: number) => Promise<void>;
  onExpire: (id: string) => Promise<void>;
  onEditContracts: (id: string, contracts: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [priceInput, setPriceInput] = useState<Record<string, string>>({});
  const [stopInput, setStopInput] = useState<Record<string, string>>({});
  const [contractsInput, setContractsInput] = useState<Record<string, string>>({});

  const price = (id: string) => Number(priceInput[id] ?? "");
  const stop = (id: string) => Number(stopInput[id] ?? "");

  if (plans.length === 0) {
    return <div className="card wheel-empty">Todavía no hay planes paper. Crea el primero arriba.</div>;
  }

  const sorted = [...plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="table-wrap">
      <table className="ideas-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Contrato</th>
            <th>Horizonte</th>
            <th>Estado</th>
            <th className="num">Gatillo</th>
            <th className="num">Objetivo</th>
            <th className="num">Stop din.</th>
            <th className="num">Entrada</th>
            <th className="num">Máximo</th>
            <th className="num">Contratos</th>
            <th className="num">P&amp;L paper</th>
            <th>Acciones</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const pnl = planPnl(p);
            return (
              <tr key={p.id}>
                <td>
                  <a className="idea-ticker" href={`/?ticker=${p.ticker}`}>{p.ticker}</a>
                </td>
                <td>
                  ${px.format(p.strike)}{p.contractType === "call" ? "C" : "P"}
                  <span className="muted"> · vence {p.expiration}</span>
                </td>
                <td className="muted">{p.horizon === "intradia" ? "Intradía" : "Swing"}</td>
                <td><span className={`chip ${STATUS_CHIP[p.status]}`}>{STATUS_LABEL[p.status]}</span></td>
                <td className="num">${px.format(p.trigger)}</td>
                <td className="num">${px.format(p.target)}</td>
                <td className="num">${px.format(p.dynamicStop)}</td>
                <td className="num">{p.entryPrice != null ? `$${px.format(p.entryPrice)}` : "—"}</td>
                <td className="num">{p.highestPrice != null ? `$${px.format(p.highestPrice)}` : "—"}</td>
                <td className="num">
                  <input
                    className="paperplan-mini-input paperplan-contracts"
                    value={contractsInput[p.id] ?? String(p.contracts)}
                    onChange={(e) => setContractsInput((s) => ({ ...s, [p.id]: e.target.value }))}
                    onBlur={() => {
                      const v = Number(contractsInput[p.id]);
                      if (Number.isFinite(v) && v > 0 && v !== p.contracts) onEditContracts(p.id, v);
                    }}
                  />
                </td>
                <td className={`num strong ${pnl != null ? (pnl >= 0 ? "chg up" : "chg down") : ""}`}>
                  {pnl != null ? money.format(pnl) : "—"}
                </td>
                <td>
                  {p.status === "pendiente" && (
                    <div className="paperplan-actions">
                      <input
                        className="paperplan-mini-input"
                        placeholder="precio entrada"
                        value={priceInput[p.id] ?? ""}
                        onChange={(e) => setPriceInput((s) => ({ ...s, [p.id]: e.target.value }))}
                      />
                      <button
                        className="copy-btn"
                        onClick={() => Number.isFinite(price(p.id)) && price(p.id) > 0 && onActivate(p.id, price(p.id))}
                      >
                        Activar
                      </button>
                      <button className="copy-btn" onClick={() => onExpire(p.id)}>Expirar</button>
                    </div>
                  )}
                  {p.status === "activa" && (
                    <div className="paperplan-actions">
                      <input
                        className="paperplan-mini-input"
                        placeholder="nuevo stop"
                        value={stopInput[p.id] ?? ""}
                        onChange={(e) => setStopInput((s) => ({ ...s, [p.id]: e.target.value }))}
                      />
                      <button
                        className="copy-btn"
                        onClick={() => Number.isFinite(stop(p.id)) && onRaiseStop(p.id, stop(p.id))}
                      >
                        Subir stop
                      </button>
                      <input
                        className="paperplan-mini-input"
                        placeholder="precio salida"
                        value={priceInput[p.id] ?? ""}
                        onChange={(e) => setPriceInput((s) => ({ ...s, [p.id]: e.target.value }))}
                      />
                      <button
                        className="copy-btn"
                        onClick={() => Number.isFinite(price(p.id)) && onClose(p.id, "ganada", price(p.id))}
                      >
                        Cerrar ganada
                      </button>
                      <button
                        className="copy-btn"
                        onClick={() => Number.isFinite(price(p.id)) && onClose(p.id, "perdida", price(p.id))}
                      >
                        Cerrar perdida
                      </button>
                      <button className="copy-btn" onClick={() => onExpire(p.id)}>Expirar</button>
                    </div>
                  )}
                  {(p.status === "ganada" || p.status === "perdida" || p.status === "expirada") && (
                    <span className="muted">
                      {p.exitedAt ? `Cerrado ${new Date(p.exitedAt).toLocaleString()}` : "Sin resolver"}
                    </span>
                  )}
                </td>
                <td>
                  <button
                    className="unstar"
                    aria-label={`Borrar plan ${p.ticker}`}
                    onClick={() => onDelete(p.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
