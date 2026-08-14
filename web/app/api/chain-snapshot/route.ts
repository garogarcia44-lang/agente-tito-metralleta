// GET /api/chain-snapshot — guarda la cadena de opciones de HOY de TODOS los
// tickers rastreados (los que ya tienen historial de flujo en data/trades/),
// no solo los ~6 que el escaneo normal (intradía/swing) analiza cada corrida.
// Por SSE, pensado para correr una vez al día (scripts/snapshot-chains.mjs +
// com.tito.chain-snapshot.plist) — ver lib/optionChainHistoryStore.ts para el
// porqué: más cobertura ahora = poder backtestear intradía con cadena real de
// más tickers dentro de unas semanas, no solo los que tuvieron la suerte de
// ser candidatos ese día.
//
// Pesado a propósito: hasta 20 requests por ticker (MARKETSNACK_MAX_EXPIRATIONS)
// × ~95 tickers, con el throttle de 120/min que ya tiene lib/marketsnack.ts —
// puede tardar bastantes minutos. Por eso corre una vez al día, no más seguido.

import { promises as fs } from "fs";
import path from "path";
import { fetchOptionChain, MarketSnackError } from "@/lib/marketsnack";
import { toRow } from "@/lib/compute";
import { saveOptionChainSnapshot } from "@/lib/optionChainHistoryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRADES_DIR = path.join(process.cwd(), "data", "trades");

interface SseEvent {
  type: "step" | "done" | "error";
  [k: string]: unknown;
}
function sse(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET() {
  const encoder = new TextEncoder();
  const now = new Date();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: SseEvent) => controller.enqueue(encoder.encode(sse(e)));

      try {
        const files = await fs.readdir(TRADES_DIR).catch(() => []);
        const tickers = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
        send({ type: "step", label: `${tickers.length} tickers rastreados — guardando la cadena de hoy de cada uno.` });

        let saved = 0;
        const failed: { ticker: string; reason: string }[] = [];

        for (const ticker of tickers) {
          try {
            const chain = await fetchOptionChain(ticker);
            if (chain.contracts.length === 0) {
              failed.push({ ticker, reason: "Sin contratos en la cadena." });
              continue;
            }
            const rows = chain.contracts.map(toRow);
            await saveOptionChainSnapshot(ticker, rows, chain.underlyingPrice, now);
            saved++;
            send({ type: "step", label: `${ticker}: ${rows.length} contratos guardados.` });
          } catch (err) {
            const reason = err instanceof MarketSnackError ? err.message : "Error inesperado.";
            failed.push({ ticker, reason });
            send({ type: "step", label: `${ticker}: falló (${reason})` });
          }
        }

        send({
          type: "done",
          tickersTotal: tickers.length,
          saved,
          failed,
          generatedAt: now.toISOString(),
        });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Error inesperado." });
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
