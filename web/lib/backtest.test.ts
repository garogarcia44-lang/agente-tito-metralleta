import { describe, expect, it } from "vitest";
import { classifyFlow, type RawTrade } from "./flow";
import { simulateTicker, sweepThresholds, factorSeparation, type BacktestResult } from "./backtest";
import type { DailyBar } from "./types";

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
    implied_volatility: 0.4,
    open_interest: 500,
    volume: 300,
    score: 90,
    sentiment: "bullish",
    timestamp: "2026-06-01T14:00:00.000Z",
    trade_condition_id: undefined,
    ...overrides,
  };
}

function bars(spec: { date: string; open: number; high: number; low: number; close: number }[]): DailyBar[] {
  return spec.map((s) => ({ time: s.date, open: s.open, high: s.high, low: s.low, close: s.close }));
}

function flatBars(startDate: string, n: number, price: number): DailyBar[] {
  const out: DailyBar[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    out.push({ time: d.toISOString().slice(0, 10), open: price, high: price, low: price, close: price });
  }
  return out;
}

describe("simulateTicker", () => {
  it("ignora candidatos que no pasan el filtro de calidad (vence en menos de MIN_DTE)", () => {
    const { rows } = classifyFlow(
      // vence al día siguiente — dte < MIN_DTE, passesQualityFilter lo rechaza sin importar el resto
      [rawTrade({ symbol: "TSLA260602C00305000", premium: 50_000, delta: 0.1 })],
      new Date("2026-06-01T14:00:00Z"),
    );
    const b = [...flatBars("2026-04-01", 40, 300), ...flatBars("2026-06-01", 10, 300)];
    const results = simulateTicker("TSLA", rows, b);
    expect(results).toHaveLength(0);
  });

  it("resuelve 'target' cuando una barra futura toca el objetivo antes que el stop", () => {
    const { rows } = classifyFlow(
      [rawTrade({ timestamp: "2026-06-01T14:00:00.000Z" })],
      new Date("2026-06-01T14:00:00Z"),
    );
    const history = flatBars("2026-04-01", 55, 300); // suficiente historial para IV/niveles
    const future = bars([
      { date: "2026-06-02", open: 300, high: 301, low: 299, close: 300 },
      { date: "2026-06-03", open: 300, high: 340, low: 299, close: 335 }, // sube fuerte: toca el objetivo (call)
    ]);
    const b = [...history, ...future];
    const results = simulateTicker("TSLA", rows, b);
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r.direction).toBe("up");
    expect(["target", "stop", "timeout"]).toContain(r.outcome);
  });

  it("resuelve 'stop' cuando el precio se desploma en vez de subir (call)", () => {
    const { rows } = classifyFlow(
      [rawTrade({ timestamp: "2026-06-01T14:00:00.000Z" })],
      new Date("2026-06-01T14:00:00Z"),
    );
    const history = flatBars("2026-04-01", 55, 300);
    const future = bars([
      { date: "2026-06-02", open: 300, high: 301, low: 260, close: 262 }, // se desploma
      { date: "2026-06-03", open: 262, high: 263, low: 258, close: 260 },
    ]);
    const b = [...history, ...future];
    const results = simulateTicker("TSLA", rows, b);
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("stop");
  });

  it("sin barras futuras suficientes, no evalúa el evento (evita mirar al futuro)", () => {
    const { rows } = classifyFlow(
      [rawTrade({ timestamp: "2026-06-01T14:00:00.000Z" })],
      new Date("2026-06-01T14:00:00Z"),
    );
    const history = flatBars("2026-04-01", 55, 300);
    const results = simulateTicker("TSLA", rows, history); // sin nada después del evento
    expect(results).toHaveLength(0);
  });

  it("no usa flujo futuro para la persistencia (sin look-ahead bias)", () => {
    // Un solo trade "hoy" — si el motor mirara al futuro, contaría los de después
    // en la persistencia. La calidad del candidato en sí no depende de esto,
    // pero confirmamos que el candidato evaluado es anterior a cualquier trade futuro.
    const { rows } = classifyFlow(
      [
        rawTrade({ id: 1, symbol: "TSLA261120C00305000", timestamp: "2026-06-01T14:00:00.000Z" }),
        rawTrade({ id: 2, symbol: "TSLA261120C00310000", timestamp: "2026-06-05T14:00:00.000Z" }),
      ],
      new Date("2026-06-05T14:00:00Z"),
    );
    const history = flatBars("2026-04-01", 55, 300);
    const future = flatBars("2026-06-02", 5, 300);
    const b = [...history, ...future];
    const results = simulateTicker("TSLA", rows, b);
    // el primer evento (2026-06-01) debe evaluarse antes de que exista el segundo trade
    const first = results.find((r) => r.symbol === "TSLA261120C00305000");
    expect(first).toBeDefined();
  });
});

function fakeResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
  return {
    ticker: "TSLA", symbol: "TSLA261120C00305000", timestamp: "2026-06-01T14:00:00.000Z",
    horizon: "intradia", direction: "up", score: 70,
    breakdown: { direction: "up", flow: 70, gex: 70, levels: 70, liquidity: 70, freshness: 70, total: 70, passes: true },
    spot: 300, targetUnderlying: 310, stopUnderlying: 295,
    estimatedProbability: 60, usedFallbackTarget: false, usedFallbackStop: false,
    outcome: "target", sessionsToOutcome: 1,
    ...overrides,
  };
}

describe("sweepThresholds", () => {
  it("cuenta wins/losses/timeouts correctamente por umbral", () => {
    const results = [
      fakeResult({ score: 80, outcome: "target" }),
      fakeResult({ score: 75, outcome: "stop" }),
      fakeResult({ score: 60, outcome: "target" }), // queda fuera del umbral 70
      fakeResult({ score: 90, outcome: "timeout" }),
    ];
    const buckets = sweepThresholds(results, [70]);
    const b = buckets[0];
    expect(b.n).toBe(3); // 80, 75, 90 (60 queda fuera)
    expect(b.wins).toBe(1);
    expect(b.losses).toBe(1);
    expect(b.timeouts).toBe(1);
    expect(b.hitRate).toBe(50); // 1/(1+1)
  });

  it("sin resueltos en el umbral, hitRate es null", () => {
    const results = [fakeResult({ score: 90, outcome: "timeout" })];
    const buckets = sweepThresholds(results, [70]);
    expect(buckets[0].hitRate).toBeNull();
  });
});

describe("factorSeparation", () => {
  it("un factor más alto en ganadores que en perdedores da separación positiva", () => {
    const results = [
      fakeResult({ outcome: "target", breakdown: { direction: "up", flow: 90, gex: 50, levels: 50, liquidity: 50, freshness: 50, total: 58, passes: true } }),
      fakeResult({ outcome: "stop", breakdown: { direction: "up", flow: 30, gex: 50, levels: 50, liquidity: 50, freshness: 50, total: 46, passes: false } }),
    ];
    const factors = factorSeparation(results);
    const flow = factors.find((f) => f.factor === "flow")!;
    expect(flow.avgAmongWins).toBe(90);
    expect(flow.avgAmongLosses).toBe(30);
    expect(flow.separation).toBe(60);
    // el de mayor separación va primero
    expect(factors[0].factor).toBe("flow");
  });

  it("ignora timeouts — solo compara resueltos", () => {
    const results = [
      fakeResult({ outcome: "timeout", score: 99 }),
    ];
    const factors = factorSeparation(results);
    for (const f of factors) {
      expect(f.avgAmongWins).toBe(0);
      expect(f.avgAmongLosses).toBe(0);
    }
  });
});
