import { describe, expect, it } from "vitest";
import { derivePlanTargets, STOP_FALLBACK_SIGMA_FRACTION } from "./planTargets";
import { expectedMove } from "./expectedMove";
import { bsPrice } from "./blackScholes";
import type { Level, LevelsReport } from "./levels";

function lvl(price: number, kind: "soporte" | "resistencia", strength = 50, distancePct = 1): Level {
  return {
    price,
    kind,
    strength,
    distancePct,
    sources: { touches: 1, lastTouch: "2026-07-20", openInterest: 0, notional: 0, flowPremium: 0, netGex: 0 },
    flipped: false,
    why: "test",
  };
}

function report(supports: Level[], resistances: Level[]): LevelsReport {
  return {
    spot: 100,
    supports,
    resistances,
    keySupport: supports[0] ?? null,
    keyResistance: resistances[0] ?? null,
    tolerancePct: 1,
  };
}

describe("derivePlanTargets", () => {
  it("call: usa la resistencia real como objetivo y el soporte real como stop", () => {
    const levels = report(
      [lvl(97, "soporte", 60, 3)],
      [lvl(104, "resistencia", 70, 4)],
    );
    const out = derivePlanTargets({
      spot: 100, iv: 0.4, days: 5, contractType: "call", strike: 100,
      entryPrice: 2, levels,
    });
    expect(out.targetUnderlying).toBe(104);
    expect(out.stopUnderlying).toBe(97);
    expect(out.usedFallbackTarget).toBe(false);
    expect(out.usedFallbackStop).toBe(false);
    expect(out.target).toBeGreaterThan(out.initialStop);
    expect(out.trigger).toBe(2);
  });

  it("call: sin nivel real, cae al borde de 1σ para el objetivo y a la fracción de σ para el stop", () => {
    const levels = report([], []);
    const out = derivePlanTargets({
      spot: 100, iv: 0.4, days: 5, contractType: "call", strike: 100,
      entryPrice: 2, levels,
    });
    const em = expectedMove(100, 0.4, 5);
    expect(out.usedFallbackTarget).toBe(true);
    expect(out.usedFallbackStop).toBe(true);
    expect(out.targetUnderlying).toBeCloseTo(em.upper1, 6);
    expect(out.stopUnderlying).toBeCloseTo(100 - em.sigma * STOP_FALLBACK_SIGMA_FRACTION, 6);
  });

  it("put: usa el soporte real como objetivo y la resistencia real como stop", () => {
    const levels = report(
      [lvl(98, "soporte", 80, 2)],
      [lvl(103, "resistencia", 55, 3)],
    );
    const out = derivePlanTargets({
      spot: 100, iv: 0.4, days: 5, contractType: "put", strike: 100,
      entryPrice: 2, levels,
    });
    expect(out.targetUnderlying).toBe(98);
    expect(out.stopUnderlying).toBe(103);
  });

  it("prefiere el nivel más fuerte dentro de 1σ, no solo el más cercano", () => {
    const levels = report(
      [],
      [lvl(101, "resistencia", 30, 1), lvl(103, "resistencia", 90, 3)],
    );
    const out = derivePlanTargets({
      spot: 100, iv: 0.4, days: 5, contractType: "call", strike: 100,
      entryPrice: 2, levels,
    });
    expect(out.targetUnderlying).toBe(103);
    expect(out.targetLevel?.strength).toBe(90);
  });

  it("ignora niveles del lado equivocado o fuera de 1σ", () => {
    const em = expectedMove(100, 0.4, 5);
    const levels = report(
      [],
      [lvl(99, "resistencia", 90, 1), lvl(em.upper1 + 50, "resistencia", 90, 40)],
    );
    const out = derivePlanTargets({
      spot: 100, iv: 0.4, days: 5, contractType: "call", strike: 100,
      entryPrice: 2, levels,
    });
    expect(out.usedFallbackTarget).toBe(true);
    expect(out.targetUnderlying).toBeCloseTo(em.upper1, 6);
  });

  it("reproyecta con Black-Scholes: el objetivo en prima coincide con bsPrice del subyacente objetivo", () => {
    const levels = report([lvl(97, "soporte", 60, 3)], [lvl(104, "resistencia", 70, 4)]);
    const out = derivePlanTargets({
      spot: 100, iv: 0.4, days: 5, contractType: "call", strike: 100,
      entryPrice: 2, levels,
    });
    const expected = bsPrice(104, 100, 5 / 365, 0.4, "call");
    expect(out.target).toBeCloseTo(expected, 6);
  });
});
