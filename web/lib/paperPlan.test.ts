import { describe, expect, it } from "vitest";
import {
  InvalidPlanTransitionError,
  activatePlan,
  canTransition,
  closePlan,
  computePnl,
  createPaperPlan,
  expirePlan,
  planPnl,
  raiseDynamicStop,
  updateHighestPrice,
  type CreatePlanInput,
} from "./paperPlan";

const NOW = new Date("2026-08-11T14:00:00Z");

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

describe("createPaperPlan", () => {
  it("arranca en pendiente, con el ticker en mayúsculas y el stop dinámico igual al inicial", () => {
    const plan = createPaperPlan(input(), NOW);
    expect(plan.status).toBe("pendiente");
    expect(plan.ticker).toBe("AAPL");
    expect(plan.dynamicStop).toBe(3.0);
    expect(plan.entryPrice).toBeNull();
    expect(plan.statusHistory).toHaveLength(1);
    expect(plan.stopHistory).toHaveLength(1);
    expect(plan.origin).toBe("manual");
    expect(plan.rulesVersion).toBeNull();
  });
});

describe("canTransition", () => {
  it("pendiente puede pasar a activa o expirada, nunca directo a ganada/perdida", () => {
    expect(canTransition("pendiente", "activa")).toBe(true);
    expect(canTransition("pendiente", "expirada")).toBe(true);
    expect(canTransition("pendiente", "ganada")).toBe(false);
    expect(canTransition("pendiente", "perdida")).toBe(false);
  });

  it("los estados terminales no van a ningún lado", () => {
    expect(canTransition("ganada", "activa")).toBe(false);
    expect(canTransition("perdida", "pendiente")).toBe(false);
    expect(canTransition("expirada", "activa")).toBe(false);
  });
});

describe("activatePlan", () => {
  it("registra precio/hora de entrada y arranca highestPrice ahí mismo", () => {
    const plan = createPaperPlan(input(), NOW);
    const active = activatePlan(plan, { price: 5.1, source: "marketsnack", at: "2026-08-11T14:05:00Z" }, NOW);
    expect(active.status).toBe("activa");
    expect(active.entryPrice).toBe(5.1);
    expect(active.highestPrice).toBe(5.1);
    expect(active.quoteSource).toBe("marketsnack");
  });

  it("no se puede activar un plan que no está pendiente", () => {
    const plan = createPaperPlan(input(), NOW);
    const active = activatePlan(plan, { price: 5.1, source: "x", at: "2026-08-11T14:05:00Z" }, NOW);
    expect(() => activatePlan(active, { price: 5.2, source: "x", at: "2026-08-11T14:06:00Z" }, NOW)).toThrow(
      InvalidPlanTransitionError,
    );
  });
});

describe("updateHighestPrice", () => {
  it("solo sube, nunca baja", () => {
    const plan = createPaperPlan(input(), NOW);
    let active = activatePlan(plan, { price: 5.0, source: "x", at: "2026-08-11T14:05:00Z" }, NOW);
    active = updateHighestPrice(active, { price: 6.5, source: "x", at: "2026-08-11T14:10:00Z" });
    expect(active.highestPrice).toBe(6.5);
    active = updateHighestPrice(active, { price: 6.0, source: "x", at: "2026-08-11T14:15:00Z" });
    expect(active.highestPrice).toBe(6.5); // no baja aunque el precio observado sea menor
  });

  it("ignora una cotización más vieja que la última vista", () => {
    const plan = createPaperPlan(input(), NOW);
    let active = activatePlan(plan, { price: 5.0, source: "x", at: "2026-08-11T14:10:00Z" }, NOW);
    active = updateHighestPrice(active, { price: 9.0, source: "x", at: "2026-08-11T14:00:00Z" }); // atrasada
    expect(active.highestPrice).toBe(5.0);
  });

  it("no hace nada si el plan sigue pendiente", () => {
    const plan = createPaperPlan(input(), NOW);
    const untouched = updateHighestPrice(plan, { price: 100, source: "x", at: "2026-08-11T14:10:00Z" });
    expect(untouched).toBe(plan);
  });
});

describe("raiseDynamicStop", () => {
  it("sube el stop y guarda el historial", () => {
    const plan = createPaperPlan(input(), NOW);
    const active = activatePlan(plan, { price: 5.0, source: "x", at: "2026-08-11T14:05:00Z" }, NOW);
    const { plan: raised, applied } = raiseDynamicStop(active, 4.0, "Protege el avance.", NOW);
    expect(applied).toBe(true);
    expect(raised.dynamicStop).toBe(4.0);
    expect(raised.stopHistory).toHaveLength(2);
  });

  it("nunca reduce un stop ya elevado", () => {
    const plan = createPaperPlan(input(), NOW);
    const active = activatePlan(plan, { price: 5.0, source: "x", at: "2026-08-11T14:05:00Z" }, NOW);
    const step1 = raiseDynamicStop(active, 4.0, "sube", NOW);
    const step2 = raiseDynamicStop(step1.plan, 3.5, "intenta bajar", NOW); // menor que 4.0
    expect(step2.applied).toBe(false);
    expect(step2.plan.dynamicStop).toBe(4.0); // sin cambio
    expect(step2.plan.stopHistory).toHaveLength(2); // no se agregó nada al historial
  });

  it("no sube el stop de un plan que no está activa", () => {
    const plan = createPaperPlan(input(), NOW);
    const { applied } = raiseDynamicStop(plan, 10, "no debería aplicar", NOW);
    expect(applied).toBe(false);
  });
});

describe("closePlan / computePnl / planPnl", () => {
  it("calcula P&L como (salida - entrada) * 100 * contratos", () => {
    expect(computePnl(5, 8, 2)).toBe(600);
    expect(computePnl(5, 3, 2)).toBe(-400);
  });

  it("cierra como ganada y expone el P&L", () => {
    const plan = createPaperPlan(input({ contracts: 2 }), NOW);
    const active = activatePlan(plan, { price: 5, source: "x", at: "2026-08-11T14:05:00Z" }, NOW);
    const closed = closePlan(active, "ganada", { price: 8, at: "2026-08-11T15:00:00Z" }, "Llegó al objetivo.", NOW);
    expect(closed.status).toBe("ganada");
    expect(planPnl(closed)).toBe(600);
  });

  it("cierra como perdida con P&L negativo", () => {
    const plan = createPaperPlan(input(), NOW);
    const active = activatePlan(plan, { price: 5, source: "x", at: "2026-08-11T14:05:00Z" }, NOW);
    const closed = closePlan(active, "perdida", { price: 3, at: "2026-08-11T15:00:00Z" }, "Se activó el stop.", NOW);
    expect(planPnl(closed)).toBe(-200);
  });

  it("un plan abierto no tiene P&L", () => {
    const plan = createPaperPlan(input(), NOW);
    expect(planPnl(plan)).toBeNull();
  });
});

describe("expirePlan", () => {
  it("expira un plan pendiente sin precio de salida", () => {
    const plan = createPaperPlan(input(), NOW);
    const expired = expirePlan(plan, "Venció sin activarse.", NOW);
    expect(expired.status).toBe("expirada");
    expect(planPnl(expired)).toBeNull();
  });

  it("expira un plan activa también", () => {
    const plan = createPaperPlan(input(), NOW);
    const active = activatePlan(plan, { price: 5, source: "x", at: "2026-08-11T14:05:00Z" }, NOW);
    const expired = expirePlan(active, "Venció activa sin resolver.", NOW);
    expect(expired.status).toBe("expirada");
  });

  it("no se puede expirar un plan ya cerrado", () => {
    const plan = createPaperPlan(input(), NOW);
    const active = activatePlan(plan, { price: 5, source: "x", at: "2026-08-11T14:05:00Z" }, NOW);
    const closed = closePlan(active, "ganada", { price: 8, at: "2026-08-11T15:00:00Z" }, "ok", NOW);
    expect(() => expirePlan(closed, "no debería poder", NOW)).toThrow(InvalidPlanTransitionError);
  });
});
