import { describe, expect, it } from "vitest";
import { classifyFlow, type RawTrade } from "./flow";
import { scoreIntradayCandidate, INTRADAY_SCORE_THRESHOLD } from "./intradayScore";
import type { GexAnalysis } from "./gex";
import type { Level } from "./levels";

const NOW = new Date("2026-07-22T21:00:00Z");

function rawTrade(overrides: Partial<RawTrade> = {}): RawTrade {
  return {
    id: 1,
    symbol: "TSLA261120C00305000",
    price: 11.7,
    size: 40,
    side: "ASKSIDE",
    bid_price: 11.55,
    ask_price: 11.75,
    premium: 2_000_000,
    delta: 0.75,
    gamma: 0.05,
    theta: -0.3,
    implied_volatility: 0.48,
    open_interest: 500,
    volume: 300,
    score: 90,
    sentiment: "bullish",
    timestamp: "2026-07-22T20:58:00.000Z", // 2 min antes de NOW
    trade_condition_id: undefined,
    ...overrides,
  };
}

function row(overrides: Partial<RawTrade> = {}) {
  const { rows } = classifyFlow([rawTrade(overrides)], NOW);
  return rows[0];
}

function gex(overrides: Partial<GexAnalysis> = {}): GexAnalysis {
  return {
    spot: 300, iv: 0.45, nodes: [], kingStrike: 305, flipStrike: 295,
    regime: "positive", totalNetGex: 1000, direction: "up", confidence: 80,
    lowLiquidity: false, n: 10,
    ...overrides,
  };
}

function level(overrides: Partial<Level> = {}): Level {
  return {
    price: 305, kind: "resistencia", strength: 85, distancePct: 1.6,
    sources: { touches: 3, lastTouch: "2026-07-20", openInterest: 500, notional: 1_000_000, flowPremium: 200_000, netGex: 500 },
    flipped: false, why: "test",
    ...overrides,
  };
}

describe("scoreIntradayCandidate", () => {
  it("confluencia total (flujo + gex + nivel + liquidez + frescura) pasa el umbral", () => {
    const out = scoreIntradayCandidate({ row: row(), gex: gex(), targetLevel: level(), now: NOW });
    expect(out.direction).toBe("up");
    expect(out.passes).toBe(true);
    expect(out.total).toBeGreaterThanOrEqual(INTRADAY_SCORE_THRESHOLD);
  });

  it("gex en contra de la dirección del flujo castiga el score", () => {
    const withGex = scoreIntradayCandidate({ row: row(), gex: gex(), targetLevel: level(), now: NOW });
    const againstGex = scoreIntradayCandidate({
      row: row(), gex: gex({ direction: "down", confidence: 80 }), targetLevel: level(), now: NOW,
    });
    expect(againstGex.gex).toBeLessThan(withGex.gex);
    expect(againstGex.total).toBeLessThan(withGex.total);
  });

  it("sin nivel real (fallback a 1σ) puntúa menos que con nivel fuerte", () => {
    const withLevel = scoreIntradayCandidate({ row: row(), gex: gex(), targetLevel: level({ strength: 90 }), now: NOW });
    const withoutLevel = scoreIntradayCandidate({ row: row(), gex: gex(), targetLevel: null, now: NOW });
    expect(withoutLevel.levels).toBeLessThan(withLevel.levels);
  });

  it("cadena ilíquida baja el sub-score de liquidez", () => {
    const liquid = scoreIntradayCandidate({ row: row(), gex: gex({ lowLiquidity: false }), targetLevel: level(), now: NOW });
    const illiquid = scoreIntradayCandidate({ row: row(), gex: gex({ lowLiquidity: true }), targetLevel: level(), now: NOW });
    expect(illiquid.liquidity).toBeLessThan(liquid.liquidity);
  });

  it("un trade viejo (poco fresco) puntúa menos que uno reciente", () => {
    const fresh = scoreIntradayCandidate({ row: row(), gex: gex(), targetLevel: level(), now: NOW });
    const stale = scoreIntradayCandidate({
      row: row({ timestamp: "2026-07-22T18:00:00.000Z" }), gex: gex(), targetLevel: level(), now: NOW,
    });
    expect(stale.freshness).toBeLessThan(fresh.freshness);
    expect(stale.total).toBeLessThan(fresh.total);
  });

  it("tipo desconocido no tiene dirección determinable → no pasa", () => {
    const out = scoreIntradayCandidate({
      row: { ...row(), type: "unknown" }, gex: gex(), targetLevel: level(), now: NOW,
    });
    expect(out.direction).toBeNull();
    expect(out.passes).toBe(false);
    expect(out.total).toBe(0);
  });

  it("un put alcista en GEX (en contra) y sin nivel no pasa el umbral", () => {
    const putRow = row({
      symbol: "TSLA261120P00305000", delta: -0.7, sentiment: "bearish",
    });
    putRow.type = "put";
    const out = scoreIntradayCandidate({
      row: putRow, gex: gex({ direction: "up", confidence: 90 }), targetLevel: null, now: NOW,
    });
    expect(out.direction).toBe("down");
    expect(out.passes).toBe(false);
  });

  it("acepta un umbral distinto al default (lo usa el ciclo de mejora aprobado)", () => {
    const out = scoreIntradayCandidate({ row: row(), gex: gex(), targetLevel: level(), now: NOW, threshold: 95 });
    expect(out.total).toBeLessThan(95);
    expect(out.passes).toBe(false);
  });
});
