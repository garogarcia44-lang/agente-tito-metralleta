"use client";

import { useState } from "react";
import type { CompanyInfo } from "@/lib/types";
import { int, money, px, pct } from "../format";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export default function CompanyHeader({ company }: { company: CompanyInfo }) {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <section className="company">
      <div className="company-head">
        {company.hasLogo && !logoFailed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="logo"
            src={`https://img.logo.dev/ticker/${encodeURIComponent(company.ticker)}?token=${process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN}`}
            alt={`${company.ticker} logo`}
            onError={() => setLogoFailed(true)}
          />
        )}
        <div className="company-id">
          <div className="company-name">
            {company.name ?? company.ticker}
            <span className="tick">{company.ticker}</span>
          </div>
          <div className="company-sub">
            {[company.exchange, company.sector].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        {company.price != null && (
          <div className="company-price">
            <div className="pxbig">{px.format(company.price)}</div>
            {company.changePercent != null && (
              <div className={company.changePercent >= 0 ? "chg up" : "chg down"}>
                {company.change != null && <>{px.format(company.change)} </>}
                ({pct.format(company.changePercent)}%)
              </div>
            )}
          </div>
        )}
      </div>

      <div className="stats">
        <Stat label="Stock Price" value={company.price != null ? px.format(company.price) : "—"} />
        <Stat label="Market Cap" value={company.marketCap != null ? money.format(company.marketCap) : "—"} />
        <Stat label="Volumen (día)" value={company.dayVolume != null ? int.format(company.dayVolume) : "—"} />
        <Stat
          label="Rango del día"
          value={
            company.dayLow != null && company.dayHigh != null
              ? `${px.format(company.dayLow)} – ${px.format(company.dayHigh)}`
              : "—"
          }
        />
        <Stat label="Cierre previo" value={company.prevClose != null ? px.format(company.prevClose) : "—"} />
        <Stat label="Empleados" value={company.employees != null ? int.format(company.employees) : "—"} />
      </div>
    </section>
  );
}
