// GET /api/scan/swing — Fase C-swing: detección automática de oportunidades
// swing (varios días/semanas), por SSE.
//
// ⚠️ SIMULACIÓN / PAPER TRADING. Mismas garantías que /api/scan/intraday: NUNCA
// coloca órdenes, nunca toca un bróker, nunca mueve dinero real.
//
// Comparte el 90% del pipeline con el escaneo intradía (mismo lib/risk.ts,
// lib/planTargets.ts, lib/planGuards.ts, lib/paperAlertSender.ts). Dos
// diferencias reales:
//   1. Escanea 5 días de flujo en vez de 1 — un swing se arma con una tesis que
//      se sostiene varios días, no con el print de la última hora.
//   2. La confluencia se mide con lib/swingScore.ts (persistencia: varios
//      prints en la misma dirección) en vez de lib/intradayScore.ts (frescura:
//      qué tan reciente es el trade) — ver ese módulo para el porqué.
//   3. Exige SWING_MIN_DTE días al vencimiento: sin eso el theta se come la
//      posición antes de que un movimiento de varios días tenga tiempo de darse.
//
// Es un escaneo "bajo demanda" (botón en /trades), no un cron todavía — mismo
// fast-follow explícitamente deferred que el escaneo intradía.

import { randomUUID } from "crypto";
import { classifyFlow, dedupeByContract, type FlowRow } from "@/lib/flow";
import { fetchMarketFlow, fetchOptionChain, MarketSnackError } from "@/lib/marketsnack";
import { isTradeableIdea, passesQualityFilter, withinMoneyness, MONEYNESS_CAP } from "@/lib/risk";
import { fetchDailyBars } from "@/lib/yahooFinance";
import { toRow } from "@/lib/compute";
import { gexAnalysis, type TradeLite } from "@/lib/gex";
import { findLevels, type ChainLevel, type FlowLevel, type GexLevel } from "@/lib/levels";
import { probTouch } from "@/lib/expectedMove";
import { derivePlanTargets } from "@/lib/planTargets";
import { scoreSwingCandidate, SWING_SCORE_THRESHOLD, SWING_MIN_DTE } from "@/lib/swingScore";
import { checkAutoPlanGuards } from "@/lib/planGuards";
import { createPaperPlan, type CreatePlanInput, type PaperPlan } from "@/lib/paperPlan";
import { loadPaperPlans, savePaperPlans } from "@/lib/paperPlansStore";
import { sendPaperAlertOnce } from "@/lib/paperAlertSender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PREMIUM = 100_000;
const MAX_PAGES = 8;
const PERIOD = "5d"; // ventana de varios días — a diferencia de intradía (1d)
const MAX_CANDIDATE_TICKERS = 6;
const RULES_VERSION = "swing-v1";

interface SseEvent {
  type: "step" | "done" | "error";
  [k: string]: unknown;
}
function sse(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function contractLabel(r: FlowRow): string {
  return `${r.underlying} $${(r.strike ?? 0).toFixed(2)}${r.type === "call" ? "C" : "P"}`;
}

export async function GET() {
  const encoder = new TextEncoder();
  const now = new Date();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: SseEvent) => controller.enqueue(encoder.encode(sse(e)));

      try {
        send({ type: "step", label: "Escaneando 5 días de flujo de todo el mercado…" });

        const { trades, pages, truncated } = await fetchMarketFlow({
          period: PERIOD,
          minPremium: MIN_PREMIUM,
          maxPages: MAX_PAGES,
          onPage: (page, accumulated) => {
            send({ type: "step", label: `Página ${page} — ${accumulated} operaciones grandes` });
          },
        });

        send({ type: "step", label: `Clasificando ${trades.length} operaciones…` });
        const { rows } = classifyFlow(trades, now);

        const tradeable = dedupeByContract(
          rows.filter(
            (r) =>
              isTradeableIdea(r) &&
              withinMoneyness(r) &&
              r.type !== "unknown" &&
              r.dte != null &&
              r.dte >= SWING_MIN_DTE,
          ),
        ).sort((a, b) => b.premium - a.premium);

        // Un solo candidato por ticker (el de mayor premium) — misma razón que
        // el escaneo intradía: la guarda de contradicción rechazaría el segundo.
        const byTicker = new Map<string, FlowRow>();
        for (const r of tradeable) if (!byTicker.has(r.underlying)) byTicker.set(r.underlying, r);
        const candidates = [...byTicker.values()];
        const selected = candidates.slice(0, MAX_CANDIDATE_TICKERS);
        const truncatedCandidates = candidates.length - selected.length;

        send({
          type: "step",
          label: `${candidates.length} tickers candidatos (≥${SWING_MIN_DTE} días al vencimiento), analizando ${selected.length}…`,
        });

        const { plans: existingPlans } = await loadPaperPlans();
        let plans = existingPlans;

        const created: { id: string; ticker: string; symbol: string; score: number }[] = [];
        const rejectedByScore: { ticker: string; symbol: string; score: number }[] = [];
        const rejectedByGuard: { ticker: string; symbol: string; reason: string }[] = [];
        const dataIssues: { ticker: string; reason: string }[] = [];

        for (const candidate of selected) {
          const ticker = candidate.underlying;
          send({ type: "step", label: `${ticker}: descargando cadena y velas…` });

          const [chain, bars] = await Promise.all([
            fetchOptionChain(ticker).catch(() => null),
            fetchDailyBars(ticker, 200).catch(() => []),
          ]);

          if (!chain || chain.contracts.length === 0 || bars.length === 0) {
            dataIssues.push({ ticker, reason: "Sin cadena de opciones o sin velas del subyacente." });
            continue;
          }

          const spot = chain.underlyingPrice ?? bars[bars.length - 1].close;
          if (!spot || spot <= 0) {
            dataIssues.push({ ticker, reason: "Sin precio del subyacente." });
            continue;
          }

          const chainRows = chain.contracts.map(toRow);
          const ownFlow = rows.filter((r) => r.underlying === ticker);
          const flowTrades: TradeLite[] = ownFlow.map((r) => ({
            strike: r.strike, type: r.type, premium: r.premium, gamma: r.gamma,
          }));

          const gex = gexAnalysis({
            rows: chainRows, closes: bars.map((b) => b.close), spot, trades: flowTrades, now,
          });

          const chainLevels: ChainLevel[] = chainRows.map((r) => ({
            strike: r.strike, contractType: r.contractType,
            openInterest: r.openInterest, notionalValue: r.notionalValue,
          }));
          const flowLevels: FlowLevel[] = ownFlow.map((r) => ({
            strike: r.strike, type: r.type, aggression: r.aggression, premium: r.premium,
          }));
          const gexLevels: GexLevel[] = gex.nodes.map((n) => ({ strike: n.strike, netGex: n.netGex }));
          const levels = findLevels({ bars, spot, chain: chainLevels, flows: flowLevels, gex: gexLevels, now });

          const days = candidate.dte ?? 0;
          const targets = derivePlanTargets({
            spot, iv: gex.iv, days,
            contractType: candidate.type === "call" ? "call" : "put",
            strike: candidate.strike ?? spot,
            entryPrice: candidate.price,
            levels,
          });

          const score = scoreSwingCandidate({ row: candidate, ownFlow, gex, targetLevel: targets.targetLevel });

          if (!score.passes) {
            rejectedByScore.push({ ticker, symbol: candidate.symbol, score: Math.round(score.total) });
            send({
              type: "step",
              label: `${contractLabel(candidate)}: descartado, score ${Math.round(score.total)}/100 (mínimo ${SWING_SCORE_THRESHOLD}).`,
            });
            continue;
          }

          const guard = checkAutoPlanGuards(plans, {
            ticker, symbol: candidate.symbol, contractType: candidate.type as "call" | "put",
          });
          if (!guard.ok) {
            rejectedByGuard.push({ ticker, symbol: candidate.symbol, reason: guard.reason ?? "" });
            send({ type: "step", label: `${contractLabel(candidate)}: descartado — ${guard.reason}` });
            continue;
          }

          const probability = Math.round(
            probTouch(spot, targets.targetUnderlying, gex.iv, days) * 100,
          );
          const factors = [
            `Score ${Math.round(score.total)}/100`,
            `Persistencia: ${score.persistence}/100`,
            `GEX ${gex.direction ?? "sin dirección"} (confianza ${gex.confidence})`,
            targets.targetLevel
              ? `Nivel real $${targets.targetLevel.price.toFixed(2)} (${targets.targetLevel.kind}, fuerza ${targets.targetLevel.strength})`
              : "Sin nivel real — objetivo al borde de 1σ",
            targets.usedFallbackStop ? "Stop sin nivel real — fracción de σ" : "Stop en nivel real",
          ];

          const input: CreatePlanInput = {
            id: randomUUID(),
            ticker,
            contractType: candidate.type as "call" | "put",
            strike: candidate.strike ?? spot,
            expiration: candidate.expiration ?? "",
            symbol: candidate.symbol,
            strategy: candidate.type === "call" ? "long_call" : "long_put",
            horizon: "swing",
            trigger: targets.trigger,
            target: targets.target,
            initialStop: targets.initialStop,
            estimatedProbability: Number.isFinite(probability) ? probability : null,
            contracts: 1,
            origin: "auto",
            rulesVersion: RULES_VERSION,
            notes: factors.join(" · "),
          };
          const plan: PaperPlan = createPaperPlan(input, now);
          plans = [...plans, plan];
          created.push({ id: plan.id, ticker, symbol: plan.symbol, score: Math.round(score.total) });

          const alert = await sendPaperAlertOnce({ plan, event: "created", factors });
          send({
            type: "step",
            label: `${contractLabel(candidate)}: plan AUTO creado (score ${Math.round(score.total)}/100)` +
              (alert.sent ? " — alerta enviada." : ` — alerta no enviada (${alert.reason ?? alert.duplicate ? "duplicada" : "ver detalle"}).`),
          });
        }

        if (created.length > 0) await savePaperPlans(plans);

        send({
          type: "done",
          created,
          rejectedByScore,
          rejectedByGuard,
          dataIssues,
          meta: {
            scanned: trades.length,
            pages,
            truncated,
            candidates: candidates.length,
            analyzed: selected.length,
            truncatedCandidates,
            scoreThreshold: SWING_SCORE_THRESHOLD,
            minDte: SWING_MIN_DTE,
            minPremium: MIN_PREMIUM,
            moneynessCap: MONEYNESS_CAP,
            generatedAt: now.toISOString(),
          },
        });
      } catch (err) {
        const message =
          err instanceof MarketSnackError ? err.message : "Error inesperado al escanear el mercado.";
        send({ type: "error", message });
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
