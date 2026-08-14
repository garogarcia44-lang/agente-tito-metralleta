// GET /api/backtest — corre lib/backtest.ts contra TODO el flujo histórico real
// ya guardado (data/trades/{TICKER}.json) + barras reales de Yahoo Finance, por
// SSE. Solo lectura: no toca planes, no manda alertas, no cambia reglas — eso lo
// decide un humano después de ver los números (ver lib/ruleProposals.ts para el
// mecanismo de aprobación, esto es investigación, no el ciclo de mejora).

import { promises as fs } from "fs";
import path from "path";
import { loadTrades } from "@/lib/store";
import { fetchDailyBars } from "@/lib/yahooFinance";
import {
  simulateTicker, sweepThresholds, factorSeparation, type BacktestResult,
} from "@/lib/backtest";

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

export async function GET() {
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

        send({
          type: "done",
          tickersProcessed: processed,
          tickersSkippedNoBars: skippedNoBars,
          totalCandidates: all.length,
          byOutcome: payload.byOutcome,
          thresholdSweep: payload.thresholdSweep,
          factorSeparation: payload.factorSeparation,
          savedTo: "data/backtest-result.json",
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
