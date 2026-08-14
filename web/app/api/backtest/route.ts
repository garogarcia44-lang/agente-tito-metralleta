// GET /api/backtest — corre lib/backtest.ts contra TODO el flujo histórico real
// ya guardado (data/trades/{TICKER}.json) + barras reales de Yahoo Finance, por
// SSE. Por default es solo lectura: no toca planes, no manda alertas, no cambia
// reglas — eso lo decide un humano después de ver los números (ver
// lib/ruleProposals.ts para el mecanismo de aprobación normal).
//
// ?apply=true es la ÚNICA excepción a esa regla en todo el proyecto, y existe
// porque Jorge la autorizó explícitamente para este camino semanal
// ("los del backtest hazlo automatico para haci no tenga que esperar mi
// autorizacion", 2026-08-14): además de correr el backtest, aplica de una vez
// cualquier umbral que lib/backtestRuleSelection.ts considere confiable
// (muestra + acierto mínimos, ver ese archivo) y dEja el cambio anotado en
// data/scanner-rules.json con status "auto_applied" — mismo archivo y misma
// forma que usa el ciclo de mejora manual, para que quede una sola fuente de
// verdad auditable de "qué cambió y por qué", diga quien lo haya decidido.
// Sin ?apply=true (el GET normal de siempre) nada de esto se toca.

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { loadTrades } from "@/lib/store";
import { fetchDailyBars } from "@/lib/yahooFinance";
import {
  simulateTicker, sweepThresholds, factorSeparation, type BacktestResult,
} from "@/lib/backtest";
import { selectRule, type AutoSelection } from "@/lib/backtestRuleSelection";
import { loadScannerRules, saveScannerRules, type RuleProposal } from "@/lib/scannerRulesStore";
import type { RuleKey } from "@/lib/ruleProposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRADES_DIR = path.join(process.cwd(), "data", "trades");
const OUT_FILE = path.join(process.cwd(), "data", "backtest-result.json");
const BARS_LOOKBACK_DAYS = 200;

interface SseEvent {
  type: "step" | "done" | "error";
  [k: string]: unknown;
}
function sse(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Aplica (si corresponde) los umbrales que lib/backtestRuleSelection.ts
 * considera confiables — I/O real sobre data/scanner-rules.json, misma forma
 * que usa "approve" en app/api/scanner-rules/route.ts, salvo que status queda
 * en "auto_applied" (nadie lo revisó) y source en "auto_backtest".
 */
async function applyAutoSelections(
  thresholdSweep: { intraday: ReturnType<typeof sweepThresholds>; swing: ReturnType<typeof sweepThresholds> },
): Promise<AutoSelection[]> {
  const file = await loadScannerRules();
  const now = new Date().toISOString();

  const candidates: [RuleKey, ReturnType<typeof sweepThresholds>][] = [
    ["intradayThreshold", thresholdSweep.intraday],
    ["swingThreshold", thresholdSweep.swing],
  ];

  const selections: AutoSelection[] = [];
  let active = file.active;
  const newProposals: RuleProposal[] = [];

  for (const [ruleKey, buckets] of candidates) {
    const selection = selectRule(ruleKey, active[ruleKey], buckets);
    if (!selection) continue;
    selections.push(selection);
    active = { ...active, [ruleKey]: selection.selectedValue };
    newProposals.push({
      id: randomUUID(),
      ruleKey,
      currentValue: selection.currentValue,
      proposedValue: selection.selectedValue,
      sampleSize: selection.bucket.wins + selection.bucket.losses,
      actualHitRate: selection.bucket.hitRate ?? 0,
      avgEstimatedProbability: 0, // no aplica a este camino — el selector no usa probabilidad estimada
      rationale: selection.rationale,
      createdAt: now,
      status: "auto_applied",
      decidedAt: now,
      source: "auto_backtest",
    });
  }

  if (newProposals.length > 0) {
    await saveScannerRules({ active, proposals: [...file.proposals, ...newProposals] });
  }
  return selections;
}

export async function GET(request: Request) {
  const apply = new URL(request.url).searchParams.get("apply") === "true";
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: SseEvent) => controller.enqueue(encoder.encode(sse(e)));

      try {
        const files = await fs.readdir(TRADES_DIR).catch(() => []);
        const tickers = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
        send({ type: "step", label: `${tickers.length} tickers con historial guardado.` });

        const all: BacktestResult[] = [];
        let processed = 0;
        let skippedNoBars = 0;

        for (const ticker of tickers) {
          const stored = await loadTrades(ticker);
          if (!stored || stored.trades.length === 0) continue;

          const bars = await fetchDailyBars(ticker, BARS_LOOKBACK_DAYS).catch(() => []);
          if (bars.length < 30) { skippedNoBars++; continue; }

          const results = simulateTicker(ticker, stored.trades, bars);
          all.push(...results);
          processed++;
          send({
            type: "step",
            label: `${ticker}: ${stored.trades.length} trades guardados → ${results.length} candidatos evaluados.`,
          });
        }

        send({ type: "step", label: `Agregando resultados de ${all.length} candidatos evaluados en total…` });

        const overall = sweepThresholds(all);
        const intraday = sweepThresholds(all.filter((r) => r.horizon === "intradia"));
        const swing = sweepThresholds(all.filter((r) => r.horizon === "swing"));
        const factors = factorSeparation(all);
        const factorsIntraday = factorSeparation(all.filter((r) => r.horizon === "intradia"));
        const factorsSwing = factorSeparation(all.filter((r) => r.horizon === "swing"));

        const payload = {
          generatedAt: new Date().toISOString(),
          tickersProcessed: processed,
          tickersSkippedNoBars: skippedNoBars,
          totalCandidates: all.length,
          byOutcome: {
            target: all.filter((r) => r.outcome === "target").length,
            stop: all.filter((r) => r.outcome === "stop").length,
            timeout: all.filter((r) => r.outcome === "timeout").length,
          },
          thresholdSweep: { overall, intraday, swing },
          factorSeparation: { overall: factors, intraday: factorsIntraday, swing: factorsSwing },
          events: all,
        };

        await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");

        let applied: AutoSelection[] = [];
        if (apply) {
          send({ type: "step", label: "Revisando si algún umbral cumple los mínimos para aplicarse solo…" });
          applied = await applyAutoSelections({ intraday, swing });
          send({
            type: "step",
            label: applied.length > 0
              ? `Aplicado(s) sin revisión humana: ${applied.map((a) => `${a.ruleKey} ${a.currentValue}→${a.selectedValue}`).join(", ")}.`
              : "Ningún umbral cumplió los mínimos esta semana — nada cambió.",
          });
        }

        send({
          type: "done",
          tickersProcessed: processed,
          tickersSkippedNoBars: skippedNoBars,
          totalCandidates: all.length,
          byOutcome: payload.byOutcome,
          thresholdSweep: payload.thresholdSweep,
          factorSeparation: payload.factorSeparation,
          savedTo: "data/backtest-result.json",
          applied,
        });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Error inesperado en el backtest." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
