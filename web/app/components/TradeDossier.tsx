"use client";

// Expediente completo de un trade — todo lo que ya sabe el sistema sobre por
// qué entró, cuándo, a qué precio, y qué noticias había. Nada de esto es dato
// nuevo: todo ya vivía en el PaperPlan (notes, statusHistory, newsAtEntry/Exit)
// — esto solo lo junta en una vista legible, en vez de estar repartido.
//
// De dónde salió cada precio (bid/ask/mid/último trade) queda en la razón de
// cada evento de la línea de tiempo, no en un campo aparte — `quoteSource` del
// plan es la ÚLTIMA cotización vista (se sobreescribe en cada chequeo del
// monitor), así que etiquetar la entrada con ese campo sería engañoso una vez
// que el plan lleva un rato activo. Por eso "Última cotización" abajo se
// muestra como lo que es: la más reciente, no la de entrada.

import type { PaperPlan } from "@/lib/paperPlan";
import type { NewsItem } from "@/lib/news";

const px = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fecha(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function NewsGroup({ title, items }: { title: string; items: NewsItem[] }) {
  return (
    <div className="dossier-news-group">
      <div className="muted">{title}</div>
      <ul className="paperplan-news-list">
        {items.map((n) => (
          <li key={n.id}>
            <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a>
            <span className="muted"> · {n.publisher} · {new Date(n.publishedUtc).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TradeDossier({ plan }: { plan: PaperPlan }) {
  const entry = plan.newsAtEntry ?? [];
  const exit = plan.newsAtExit ?? [];

  return (
    <div className="dossier">
      <div className="dossier-facts">
        <div>
          <div className="muted">Contrato</div>
          <div>{plan.contractType === "call" ? "Call" : "Put"} ${px.format(plan.strike)} · vence {plan.expiration}</div>
        </div>
        <div>
          <div className="muted">Horizonte</div>
          <div>{plan.horizon === "intradia" ? "Intradía" : "Swing"} · {plan.origin === "auto" ? "automático" : "manual"}</div>
        </div>
        <div>
          <div className="muted">Creado</div>
          <div>{fecha(plan.createdAt)}</div>
        </div>
        <div>
          <div className="muted">Entrada</div>
          <div>{fecha(plan.enteredAt)}{plan.entryPrice != null ? ` · $${px.format(plan.entryPrice)}` : ""}</div>
        </div>
        <div>
          <div className="muted">Salida</div>
          <div>{fecha(plan.exitedAt)}{plan.exitPrice != null ? ` · $${px.format(plan.exitPrice)}` : ""}</div>
        </div>
        <div>
          <div className="muted">Objetivo / stop</div>
          <div>${px.format(plan.target)} / ${px.format(plan.dynamicStop)}</div>
        </div>
        {plan.quoteSource && (
          <div>
            <div className="muted">Última cotización revisada</div>
            <div>{plan.quoteSource}{plan.quoteAt ? ` · ${fecha(plan.quoteAt)}` : ""}</div>
          </div>
        )}
      </div>

      {plan.notes && (
        <div className="dossier-section">
          <div className="muted">Por qué entró</div>
          <p className="dossier-notes">{plan.notes}</p>
        </div>
      )}

      {plan.scoreBreakdown && (
        <div className="dossier-section">
          <div className="muted">Desglose del score</div>
          <div className="dossier-score-grid">
            {Object.entries(plan.scoreBreakdown).map(([factor, value]) => (
              <div key={factor} className={factor === "total" ? "dossier-score-total" : undefined}>
                <span className="dossier-score-label">{factor}</span>
                <span>{Math.round(value)}/100</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.statusHistory.length > 0 && (
        <div className="dossier-section">
          <div className="muted">Línea de tiempo</div>
          <ul className="dossier-timeline">
            {plan.statusHistory.map((s, i) => (
              <li key={i}>
                <span className="dossier-timeline-date">{fecha(s.at)}</span> — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(entry.length > 0 || exit.length > 0) && (
        <div className="dossier-section">
          <div className="muted">Noticias reales del momento</div>
          <div className="paperplan-news">
            {entry.length > 0 && <NewsGroup title="Al entrar" items={entry} />}
            {exit.length > 0 && <NewsGroup title="Al cerrar/expirar" items={exit} />}
          </div>
        </div>
      )}
    </div>
  );
}
