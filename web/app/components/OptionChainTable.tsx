"use client";

import { useMemo, useState } from "react";
import type { ChainMeta, Row } from "@/lib/types";
import { int, money, money0, px } from "../format";

type SortKey =
  | "expiration" | "contractType" | "strike" | "openInterest"
  | "volume" | "price" | "openPremium" | "notionalValue";

export default function OptionChainTable({ rows, meta }: { rows: Row[]; meta: ChainMeta }) {
  const [sortKey, setSortKey] = useState<SortKey>("openInterest");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir(key === "expiration" || key === "contractType" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [rows, sortKey, sortDir]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.openInterest += r.openInterest;
        acc.volume += r.volume;
        acc.openPremium += r.openPremium ?? 0;
        acc.notionalValue += r.notionalValue;
        return acc;
      },
      { openInterest: 0, volume: 0, openPremium: 0, notionalValue: 0 },
    );
  }, [rows]);

  const arrow = (key: SortKey) => (key === sortKey ? (sortDir === "desc" ? " ↓" : " ↑") : "");

  return (
    <>
      <div className="meta">
        <span><b>{int.format(meta.contractCount)}</b> contratos</span>
        <span><b>{meta.expirationCount}</b> vencimientos</span>
        <span>Notional total <b title={money0.format(totals.notionalValue)}>{money.format(totals.notionalValue)}</b></span>
        {meta.truncated && <span className="warn">⚠ truncado (tope de páginas)</span>}
      </div>
      <div className="tablewrap tall">
        <table>
          <thead>
            <tr>
              <th onClick={() => toggleSort("expiration")}>Vencimiento{arrow("expiration")}</th>
              <th onClick={() => toggleSort("contractType")}>Tipo{arrow("contractType")}</th>
              <th onClick={() => toggleSort("strike")}>Strike{arrow("strike")}</th>
              <th onClick={() => toggleSort("openInterest")}>Open Interest{arrow("openInterest")}</th>
              <th onClick={() => toggleSort("volume")}>Volumen{arrow("volume")}</th>
              <th onClick={() => toggleSort("price")}>Precio{arrow("price")}</th>
              <th onClick={() => toggleSort("openPremium")}>Open Premium{arrow("openPremium")}</th>
              <th onClick={() => toggleSort("notionalValue")}>Notional Value{arrow("notionalValue")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.optionTicker || i}>
                <td>{r.expiration}</td>
                <td><span className={`pill ${r.contractType}`}>{r.contractType}</span></td>
                <td>{px.format(r.strike)}</td>
                <td>{int.format(r.openInterest)}</td>
                <td>{int.format(r.volume)}</td>
                <td>{r.price != null ? px.format(r.price) : <span className="na">n/a</span>}</td>
                <td>{r.openPremium != null ? money.format(r.openPremium) : <span className="na">n/a</span>}</td>
                <td>{money.format(r.notionalValue)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="totals">
              <td>TOTAL</td>
              <td className="muted">{sorted.length} filas</td>
              <td className="muted">—</td>
              <td>{int.format(totals.openInterest)}</td>
              <td>{int.format(totals.volume)}</td>
              <td className="muted">—</td>
              <td>{money.format(totals.openPremium)}</td>
              <td title={money0.format(totals.notionalValue)}>{money.format(totals.notionalValue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="pxsrc" style={{ marginTop: 10 }}>
        Precio = último trade / cierre (esta tabla no usa bid/ask). Open Premium = OI × precio · Notional = OI × 100 × strike.
      </p>
    </>
  );
}
