import { describe, expect, it } from "vitest";
import { evaluatePlan } from "./planMonitor";
import { createPaperPlan, activatePlan, type CreatePlanInput, type PaperPlan } from "./paperPlan";

const NOW = new Date("2026-08-14T15:00:00Z");

function input(p: Partial<CreatePlanInput> = {}): CreatePlanInput {
  return {
    id: "plan-1",
    ticker: "aapl",
    contractType: "call",
    strike: 230,
    expiration: "2026-09-18",
    symbol: "AAPL260918C00230000",
    strategy: "long_call",
    horizon: "swing",
    trigger: 5.0,
    target: 8.0,
    initialStop: 3.0,
    contracts: 1,
    ...p,
  };
}

function quote(price: number, at = "2026-08-14T15:05:00Z") {
  return { price, source: "marketsnack", at };
}

describe("evaluatePlan", () => {
  it("ignora planes en estados terminales", () => {
    const plan: PaperPlan = { ...createPaperPlan(input(), NOW), status: "ganada" };
    expect(evaluatePlan(plan, quote(6), NOW)).toBeNull();
  });

  it("pendiente → activa en el primer chequeo, con la prima observada como entrada", () => {
    const plan = createPaperPlan(input(), NOW);
    const action = evaluatePlan(plan, quote(5.3), NOW);
    expect(action).toEqual({ type: "activate", entry: quote(5.3) });
  });

  it("expira si el contrato ya venció, sin importar el estado", () => {
    const plan = createPaperPlan(input({ expiration: "2026-08-01" }), NOW);
    const action = evaluatePlan(plan, quote(5.3), NOW);
    expect(action?.type).toBe("expire");
  });

  it("activa: cierra ganada si la prima alcanzó o superó el objetivo", () => {
    const pending = createPaperPlan(input(), NOW);
    const active = activatePlan(pending, quote(5.0, NOW.toISOString()), NOW);
    const action = evaluatePlan(active, quote(8.0), NOW);
    expect(action).toMatchObject({ type: "close", outcome: "ganada" });
  });

  it("activa: cierra perdida si la prima cayó al stop dinámico o por debajo", () => {
    const pending = createPaperPlan(input(), NOW);
    const active = activatePlan(pending, quote(5.0, NOW.toISOString()), NOW);
    const action = evaluatePlan(active, quote(3.0), NOW);
    expect(action).toMatchObject({ type: "close", outcome: "perdida" });
  });

  it("activa: si no tocó ni objetivo ni stop, solo actualiza el máximo", () => {
    const pending = createPaperPlan(input(), NOW);
    const active = activatePlan(pending, quote(5.0, NOW.toISOString()), NOW);
    const action = evaluatePlan(active, quote(6.2), NOW);
    expect(action).toEqual({ type: "updateHighest", observed: quote(6.2) });
  });

  it("usa >= y <= exactos en los bordes (target y dynamicStop)", () => {
    const pending = createPaperPlan(input(), NOW);
    const active = activatePlan(pending, quote(5.0, NOW.toISOString()), NOW);
    expect(evaluatePlan(active, quote(active.target), NOW)?.type).toBe("close");
    expect(evaluatePlan(active, quote(active.dynamicStop), NOW)?.type).toBe("close");
  });
});
