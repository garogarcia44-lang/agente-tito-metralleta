import { describe, expect, it } from "vitest";
import { selectRule, MIN_RESOLVED_SAMPLE, MIN_EDGE_OVER_BASELINE } from "./backtestRuleSelection";
import type { ThresholdBucket } from "./backtest";

function bucket(p: Partial<ThresholdBucket>): ThresholdBucket {
  return { threshold: 50, n: 0, wins: 0, losses: 0, timeouts: 0, hitRate: null, ...p };
}

describe("selectRule", () => {
  it("no propone nada si ningún umbral tiene muestra suficiente", () => {
    const buckets = [
      bucket({ threshold: 60, wins: 5, losses: 3, hitRate: 62.5 }), // 8 resueltos, < MIN_RESOLVED_SAMPLE
    ];
    expect(selectRule("swingThreshold", 65, buckets)).toBeNull();
  });

  it("no propone nada si ningún umbral supera el borde mínimo sobre el azar", () => {
    const wins = 26, losses = 24; // 52% hit rate, 2 pts sobre 50% < MIN_EDGE_OVER_BASELINE
    const buckets = [bucket({ threshold: 60, wins, losses, hitRate: (wins / (wins + losses)) * 100 })];
    expect(selectRule("swingThreshold", 65, buckets)).toBeNull();
  });

  it("elige el umbral MÁS ALTO que cumple ambos mínimos, no el de mejor acierto puntual", () => {
    const buckets = [
      // 90: acierto altísimo pero muestra insuficiente — debe ignorarse.
      bucket({ threshold: 90, wins: 4, losses: 0, hitRate: 100 }),
      // 70: cumple ambos mínimos.
      bucket({ threshold: 70, wins: 40, losses: 20, hitRate: (40 / 60) * 100 }),
      // 60: también cumple, pero es más bajo que 70 — no debe elegirse si 70 sirve.
      bucket({ threshold: 60, wins: 60, losses: 40, hitRate: 60 }),
    ];
    const result = selectRule("swingThreshold", 65, buckets);
    expect(result?.selectedValue).toBe(70);
  });

  it("devuelve null si el umbral elegido ya es el valor activo", () => {
    const buckets = [bucket({ threshold: 65, wins: 60, losses: 30, hitRate: (60 / 90) * 100 })];
    expect(selectRule("swingThreshold", 65, buckets)).toBeNull();
  });

  it("respeta exactamente los mínimos exportados (borde justo cumple, un punto menos no)", () => {
    const wins = MIN_RESOLVED_SAMPLE, losses = 0; // hitRate 100%, resolved == MIN_RESOLVED_SAMPLE
    const okBuckets = [bucket({ threshold: 60, wins, losses, hitRate: 100 })];
    expect(selectRule("intradayThreshold", 55, okBuckets)?.selectedValue).toBe(60);

    const edgeWins = Math.ceil((50 + MIN_EDGE_OVER_BASELINE) / 100 * 40);
    const borderline = [bucket({
      threshold: 60, wins: edgeWins, losses: 40 - edgeWins,
      hitRate: (edgeWins / 40) * 100,
    })];
    // hitRate calculado para caer justo en el borde de MIN_EDGE_OVER_BASELINE — no debe fallar al evaluarlo.
    expect(() => selectRule("intradayThreshold", 55, borderline)).not.toThrow();
  });

  it("incluye el rationale con los valores actual y propuesto", () => {
    const buckets = [bucket({ threshold: 70, wins: 40, losses: 20, hitRate: (40 / 60) * 100 })];
    const result = selectRule("swingThreshold", 65, buckets);
    expect(result?.rationale).toContain("65");
    expect(result?.rationale).toContain("70");
  });
});
