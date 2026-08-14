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

  it("reproyecta con Black-Scholes: el objetivo en prima es entryPrice + el delta modelado (spot → objetivo)", () => {
    const levels = report([lvl(97, "soporte", 60, 3)], [lvl(104, "resistencia", 70, 4)]);
    const out = derivePlanTargets({
      spot: 100, iv: 0.4, days: 5, contractType: "call", strike: 100,
      entryPrice: 2, levels,
    });
    const delta = bsPrice(104, 100, 5 / 365, 0.4, "call") - bsPrice(100, 100, 5 / 365, 0.4, "call");
    expect(out.target).toBeCloseTo(2 + delta, 6);
  });

  it("target y stop SIEMPRE quedan del lado correcto de entryPrice, aunque la prima real observada esté muy lejos del valor absoluto del modelo (bug real 2026-08-14: antes el objetivo podía salir por DEBAJO de la entrada)", () => {
    const levels = report([lvl(97, "soporte", 60, 3)], [lvl(104, "resistencia", 70, 4)]);
    // entryPrice muy por encima de lo que el modelo diría para spot=100 —
    // exactamente el escenario real (prima observada en el flujo real vs.
    // valuación teórica de Black-Scholes con una IV estimada).
    const farOffEntry = 70;
    const call = derivePlanTargets({
      spot: 100, iv: 0.4, days: 5, contractType: "call", strike: 100,
      entryPrice: farOffEntry, levels,
    });
    expect(call.target).toBeGreaterThan(farOffEntry);
    expect(call.initialStop).toBeLessThan(farOffEntry);

    const putLevels = report([lvl(98, "soporte", 80, 2)], [lvl(103, "resistencia", 55, 3)]);
    const put = derivePlanTargets({
      spot: 100, iv: 0.4, days: 5, contractType: "put", strike: 100,
      entryPrice: farOffEntry, levels: putLevels,
    });
    expect(put.target).toBeGreaterThan(farOffEntry);
    expect(put.initialStop).toBeLessThan(farOffEntry);
  });
});
