import { describe, expect, it } from "vitest";
import { proposeRuleChanges, PROPOSAL_CAP } from "./ruleProposals";
import { DEFAULT_SCANNER_RULES } from "./scannerRules";
import {
  activatePlan, closePlan, createPaperPlan, type CreatePlanInput, type PaperPlan,
} from "./paperPlan";

const T0 = new Date("2026-07-22T14:30:00Z");

let seq = 0;

function baseInput(overrides: Partial<CreatePlanInput> = {}): CreatePlanInput {
  seq += 1;
  return {
    id: overrides.id ?? `p${seq}`,
    ticker: "TSLA",
    contractType: "call",
    strike: 305,
    expiration: "2026-11-20",
    symbol: overrides.symbol ?? `TSLA261120C${String(seq).padStart(8, "0")}`,
    strategy: "long_call",
    horizon: "intradia",
    trigger: 2,
    target: 5,
    initialStop: 1,
    contracts: 1,
    origin: "auto",
    estimatedProbability: null,
    ...overrides,
  };
}

function resolved(outcome: "ganada" | "perdida", overrides: Partial<CreatePlanInput> = {}): PaperPlan {
  const plan = createPaperPlan(baseInput(overrides), T0);
  const active = activatePlan(plan, { price: 2, source: "manual", at: T0.toISOString() }, T0);
  const exitPrice = outcome === "ganada" ? 5 : 1;
  return closePlan(active, outcome, { price: exitPrice, at: T0.toISOString() }, "prueba", T0);
}

function manyPlans(n: number, outcome: "ganada" | "perdida", prob: number, overrides: Partial<CreatePlanInput> = {}) {
  return Array.from({ length: n }, (_, i) => resolved(outcome, { id: `p${i}-${outcome}`, ...overrides, estimatedProbability: prob }));
}

describe("proposeRuleChanges", () => {
  it("sin planes, no propone nada", () => {
    expect(proposeRuleChanges([], DEFAULT_SCANNER_RULES)).toEqual([]);
  });

  it("con muestra insuficiente (menos del mínimo), no propone nada", () => {
    const plans = [resolved("ganada", { estimatedProbability: 90 })];
    expect(proposeRuleChanges(plans, DEFAULT_SCANNER_RULES)).toEqual([]);
  });

  it("sobreconfianza sostenida (prob. alta, pierde casi todo) propone un umbral MÁS estricto", () => {
    const plans = [
      ...manyPlans(4, "perdida", 85),
      resolved("ganada", { id: "w1", estimatedProbability: 85 }),
    ];
    const [draft] = proposeRuleChanges(plans, DEFAULT_SCANNER_RULES);
    expect(draft.ruleKey).toBe("intradayThreshold");
    expect(draft.proposedValue).toBeGreaterThan(draft.currentValue);
    expect(draft.proposedValue - draft.currentValue).toBeLessThanOrEqual(PROPOSAL_CAP);
    expect(draft.sampleSize).toBe(5);
  });

  it("subconfianza sostenida (prob. baja, gana casi todo) propone un umbral MENOS estricto", () => {
    const plans = [
      ...manyPlans(4, "ganada", 20),
      resolved("perdida", { id: "l1", estimatedProbability: 20 }),
    ];
    const [draft] = proposeRuleChanges(plans, DEFAULT_SCANNER_RULES);
    expect(draft.proposedValue).toBeLessThan(draft.currentValue);
  });

  it("bien calibrado (prob. y tasa real coinciden), no propone nada", () => {
    // 3 gana / 2 pierde ≈ 60% real, prob promedio 60% → sin desviación significativa.
    const plans = [
      ...manyPlans(3, "ganada", 60, { id: "w" }),
      ...manyPlans(2, "perdida", 60, { id: "l" }),
    ];
    expect(proposeRuleChanges(plans, DEFAULT_SCANNER_RULES)).toEqual([]);
  });

  it("ignora planes manuales — solo AUTO alimenta el ciclo de mejora", () => {
    const plans = manyPlans(5, "perdida", 90, { origin: "manual" });
    expect(proposeRuleChanges(plans, DEFAULT_SCANNER_RULES)).toEqual([]);
  });

  it("intradía y swing se evalúan por separado", () => {
    const plans = [
      ...manyPlans(5, "perdida", 90, { horizon: "intradia" }),
      ...manyPlans(5, "ganada", 15, { horizon: "swing" }),
    ];
    const drafts = proposeRuleChanges(plans, DEFAULT_SCANNER_RULES);
    expect(drafts).toHaveLength(2);
    const intraday = drafts.find((d) => d.ruleKey === "intradayThreshold")!;
    const swing = drafts.find((d) => d.ruleKey === "swingThreshold")!;
    expect(intraday.proposedValue).toBeGreaterThan(intraday.currentValue);
    expect(swing.proposedValue).toBeLessThan(swing.currentValue);
  });

  it("nunca propone fuera de 0-100", () => {
    const plans = manyPlans(20, "perdida", 100);
    const drafts = proposeRuleChanges(plans, { intradayThreshold: 98, swingThreshold: 70 });
    const intraday = drafts.find((d) => d.ruleKey === "intradayThreshold");
    if (intraday) expect(intraday.proposedValue).toBeLessThanOrEqual(100);
  });
});
