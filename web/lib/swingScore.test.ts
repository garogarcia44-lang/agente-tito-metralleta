import { describe, expect, it } from "vitest";
import { classifyFlow, type RawTrade } from "./flow";
import { scoreSwingCandidate, SWING_SCORE_THRESHOLD } from "./swingScore";
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
    timestamp: "2026-07-22T20:58:00.000Z",
    trade_condition_id: undefined,
    ...overrides,
  };
}

function rows(overridesList: Partial<RawTrade>[]) {
  const { rows } = classifyFlow(overridesList.map((o) => rawTrade(o)), NOW);
  return rows;
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

describe("scoreSwingCandidate", () => {
  it("varios prints inusuales en la misma dirección suben el score vs uno solo", () => {
    const [row] = rows([{ id: 1, symbol: "TSLA261120C00305000", premium: 2_000_000 }]);
    const single = scoreSwingCandidate({ row, ownFlow: [row], gex: gex(), targetLevel: level() });

    const many = rows([
      { id: 1, symbol: "TSLA261120C00305000", premium: 2_000_000, timestamp: "2026-07-20T18:00:00.000Z" },
      { id: 2, symbol: "TSLA261120C00310000", premium: 1_500_000, timestamp: "2026-07-21T18:00:00.000Z" },
      { id: 3, symbol: "TSLA261120C00315000", premium: 1_800_000, timestamp: "2026-07-22T18:00:00.000Z" },
    ]);
    const multi = scoreSwingCandidate({ row: many[0], ownFlow: many, gex: gex(), targetLevel: level() });

    expect(multi.persistence).toBeGreaterThan(single.persistence);
    expect(multi.total).toBeGreaterThan(single.total);
  });

  it("prints en dirección contraria no cuentan como persistencia", () => {
    const [call] = rows([{ id: 1, symbol: "TSLA261120C00305000", premium: 2_000_000 }]);
    const [put] = rows([{ id: 2, symbol: "TSLA261120P00305000", premium: 2_000_000, delta: -0.7 }]);
    const out = scoreSwingCandidate({ row: call, ownFlow: [call, put], gex: gex(), targetLevel: level() });
    expect(out.persistence).toBe(40); // solo 1 (el propio call) cuenta
  });

  it("confluencia fuerte con varios prints pasa el umbral", () => {
    const many = rows([
      { id: 1, symbol: "TSLA261120C00305000", premium: 2_000_000, timestamp: "2026-07-18T18:00:00.000Z" },
      { id: 2, symbol: "TSLA261120C00310000", premium: 1_500_000, timestamp: "2026-07-19T18:00:00.000Z" },
      { id: 3, symbol: "TSLA261120C00315000", premium: 1_800_000, timestamp: "2026-07-20T18:00:00.000Z" },
      { id: 4, symbol: "TSLA261120C00320000", premium: 1_200_000, timestamp: "2026-07-21T18:00:00.000Z" },
    ]);
    const out = scoreSwingCandidate({ row: many[0], ownFlow: many, gex: gex(), targetLevel: level() });
    expect(out.passes).toBe(true);
    expect(out.total).toBeGreaterThanOrEqual(SWING_SCORE_THRESHOLD);
  });

  it("tipo desconocido no tiene dirección determinable → no pasa", () => {
    const [row] = rows([{ id: 1, symbol: "TSLA261120C00305000" }]);
    const out = scoreSwingCandidate({
      row: { ...row, type: "unknown" }, ownFlow: [row], gex: gex(), targetLevel: level(),
    });
    expect(out.direction).toBeNull();
    expect(out.passes).toBe(false);
    expect(out.total).toBe(0);
  });

  it("gex en contra castiga el score igual que en intradía", () => {
    const [row] = rows([{ id: 1, symbol: "TSLA261120C00305000", premium: 2_000_000 }]);
    const withGex = scoreSwingCandidate({ row, ownFlow: [row], gex: gex({ direction: "up" }), targetLevel: level() });
    const againstGex = scoreSwingCandidate({ row, ownFlow: [row], gex: gex({ direction: "down" }), targetLevel: level() });
    expect(againstGex.gex).toBeLessThan(withGex.gex);
  });
});
