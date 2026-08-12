import { describe, expect, it } from "vitest";
import { buildPaperResults, CALIBRATION_MIN_SAMPLES } from "./paperResults";
import {
  activatePlan, closePlan, createPaperPlan, expirePlan,
  type CreatePlanInput, type PaperPlan,
} from "./paperPlan";

const T0 = new Date("2026-07-22T14:30:00Z");

function baseInput(overrides: Partial<CreatePlanInput> = {}): CreatePlanInput {
  return {
    id: overrides.id ?? "p1",
    ticker: "TSLA",
    contractType: "call",
    strike: 305,
    expiration: "2026-11-20",
    symbol: "TSLA261120C00305000",
    strategy: "long_call",
    horizon: "intradia",
    trigger: 2,
    target: 5,
    initialStop: 1,
    contracts: 1,
    origin: "manual",
    estimatedProbability: null,
    ...overrides,
  };
}

function pending(overrides: Partial<CreatePlanInput> = {}): PaperPlan {
  return createPaperPlan(baseInput(overrides), T0);
}

function won(overrides: Partial<CreatePlanInput> = {}, entry = 2, exit = 5): PaperPlan {
  const plan = pending(overrides);
  const active = activatePlan(plan, { price: entry, source: "manual", at: T0.toISOString() }, T0);
  return closePlan(active, "ganada", { price: exit, at: T0.toISOString() }, "objetivo", T0);
}

function lost(overrides: Partial<CreatePlanInput> = {}, entry = 2, exit = 1): PaperPlan {
  const plan = pending(overrides);
  const active = activatePlan(plan, { price: entry, source: "manual", at: T0.toISOString() }, T0);
  return closePlan(active, "perdida", { price: exit, at: T0.toISOString() }, "stop", T0);
}

function neverActivated(overrides: Partial<CreatePlanInput> = {}): PaperPlan {
  return expirePlan(pending(overrides), "no se activó", T0);
}

function timedOut(overrides: Partial<CreatePlanInput> = {}): PaperPlan {
  const plan = pending(overrides);
  const active = activatePlan(plan, { price: 2, source: "manual", at: T0.toISOString() }, T0);
  return expirePlan(active, "venció sin resolver", T0);
}

describe("buildPaperResults — overall", () => {
  it("clasifica cada estado en su balde correcto", () => {
    const plans = [
      won({ id: "w1" }),
      lost({ id: "l1" }),
      neverActivated({ id: "n1" }),
      timedOut({ id: "t1" }),
      pending({ id: "p1" }),
    ];
    const r = buildPaperResults(plans).overall;
    expect(r.total).toBe(5);
    expect(r.wins).toBe(1);
    expect(r.losses).toBe(1);
    expect(r.neverActivated).toBe(1);
    expect(r.timedOut).toBe(1);
    expect(r.open).toBe(1);
    expect(r.resolved).toBe(2);
    expect(r.hitRate).toBe(50);
  });

  it("P&L acumulado suma solo ganada/perdida", () => {
    const plans = [won({ id: "w1" }, 2, 5), lost({ id: "l1" }, 2, 1)];
    const r = buildPaperResults(plans).overall;
    // ganada: (5-2)*100*1=300, perdida: (1-2)*100*1=-100
    expect(r.totalPnl).toBe(200);
    expect(r.avgPnl).toBe(100);
  });

  it("sin planes resueltos, hitRate y avgPnl son null", () => {
    const r = buildPaperResults([pending({ id: "p1" })]).overall;
    expect(r.hitRate).toBeNull();
    expect(r.avgPnl).toBeNull();
    expect(r.totalPnl).toBe(0);
  });
});

describe("buildPaperResults — por horizonte y origen", () => {
  it("separa intradía de swing", () => {
    const plans = [
      won({ id: "i1", horizon: "intradia" }),
      lost({ id: "s1", horizon: "swing" }),
    ];
    const r = buildPaperResults(plans);
    expect(r.byHorizon.intradia.total).toBe(1);
    expect(r.byHorizon.intradia.wins).toBe(1);
    expect(r.byHorizon.swing.total).toBe(1);
    expect(r.byHorizon.swing.losses).toBe(1);
  });

  it("separa auto de manual", () => {
    const plans = [
      won({ id: "a1", origin: "auto" }),
      lost({ id: "m1", origin: "manual" }),
    ];
    const r = buildPaperResults(plans);
    expect(r.byOrigin.auto.wins).toBe(1);
    expect(r.byOrigin.manual.losses).toBe(1);
  });
});

describe("buildPaperResults — calibración", () => {
  it("agrupa por bucket de estimatedProbability y calcula la tasa real", () => {
    const plans = [
      won({ id: "w1", estimatedProbability: 80 }),
      won({ id: "w2", estimatedProbability: 85 }),
      lost({ id: "l1", estimatedProbability: 82 }),
    ];
    const bucket = buildPaperResults(plans).calibration.find((b) => b.label === "75-100%")!;
    expect(bucket.n).toBe(3);
    expect(bucket.wins).toBe(2);
    expect(bucket.actualRate).toBeCloseTo((2 / 3) * 100, 6);
  });

  it("marca la muestra como insuficiente por debajo del mínimo", () => {
    const plans = [won({ id: "w1", estimatedProbability: 60 })];
    const bucket = buildPaperResults(plans).calibration.find((b) => b.label === "50-75%")!;
    expect(bucket.n).toBe(1);
    expect(bucket.sufficientSample).toBe(false);
    expect(CALIBRATION_MIN_SAMPLES).toBeGreaterThan(1);
  });

  it("ignora planes sin estimatedProbability y planes no resueltos", () => {
    const plans = [
      won({ id: "w1", estimatedProbability: null }),
      pending({ id: "p1", estimatedProbability: 90 }),
    ];
    const total = buildPaperResults(plans).calibration.reduce((s, b) => s + b.n, 0);
    expect(total).toBe(0);
  });

  it("el 100% cae en el último bucket (inclusivo en el borde superior)", () => {
    const plans = [won({ id: "w1", estimatedProbability: 100 })];
    const bucket = buildPaperResults(plans).calibration.find((b) => b.label === "75-100%")!;
    expect(bucket.n).toBe(1);
  });
});
