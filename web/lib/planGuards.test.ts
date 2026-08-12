import { describe, expect, it } from "vitest";
import { checkAutoPlanGuards, checkContradiction, checkDuplicate } from "./planGuards";
import { createPaperPlan, type CreatePlanInput, type PaperPlan } from "./paperPlan";

const NOW = new Date("2026-07-22T21:00:00Z");

function plan(overrides: Partial<CreatePlanInput> = {}): PaperPlan {
  return createPaperPlan(
    {
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
      ...overrides,
    },
    NOW,
  );
}

describe("checkDuplicate", () => {
  it("rechaza el mismo símbolo si ya hay un plan pendiente", () => {
    const existing = [plan()];
    const out = checkDuplicate(existing, "TSLA261120C00305000");
    expect(out.ok).toBe(false);
    expect(out.conflictingPlan?.id).toBe("p1");
  });

  it("permite el mismo símbolo si el plan anterior ya cerró", () => {
    const closed = { ...plan(), status: "ganada" as const };
    const out = checkDuplicate([closed], "TSLA261120C00305000");
    expect(out.ok).toBe(true);
  });

  it("permite símbolos distintos", () => {
    const out = checkDuplicate([plan()], "TSLA261120C00310000");
    expect(out.ok).toBe(true);
  });
});

describe("checkContradiction", () => {
  it("rechaza un put nuevo si ya hay un call vigente en el mismo ticker", () => {
    const existing = [plan({ contractType: "call" })];
    const out = checkContradiction(existing, "TSLA", "put");
    expect(out.ok).toBe(false);
  });

  it("permite otro call en el mismo ticker (misma dirección)", () => {
    const existing = [plan({ contractType: "call", id: "p1", symbol: "TSLA261120C00305000" })];
    const out = checkContradiction(existing, "TSLA", "call");
    expect(out.ok).toBe(true);
  });

  it("permite dirección contraria en un ticker distinto", () => {
    const existing = [plan({ contractType: "call", ticker: "TSLA" })];
    const out = checkContradiction(existing, "AAPL", "put");
    expect(out.ok).toBe(true);
  });

  it("ignora planes ya cerrados al revisar contradicción", () => {
    const existing = [{ ...plan({ contractType: "call" }), status: "expirada" as const }];
    const out = checkContradiction(existing, "TSLA", "put");
    expect(out.ok).toBe(true);
  });

  it("es case-insensitive con el ticker", () => {
    const existing = [plan({ contractType: "call", ticker: "tsla" })];
    const out = checkContradiction(existing, "TSLA", "put");
    expect(out.ok).toBe(false);
  });
});

describe("checkAutoPlanGuards", () => {
  it("corre duplicado antes que contradicción y reporta el primero que falle", () => {
    const existing = [plan()];
    const out = checkAutoPlanGuards(existing, {
      ticker: "TSLA", symbol: "TSLA261120C00305000", contractType: "call",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/contrato exacto/);
  });

  it("pasa cuando no hay duplicado ni contradicción", () => {
    const existing = [plan()];
    const out = checkAutoPlanGuards(existing, {
      ticker: "TSLA", symbol: "TSLA261120C00310000", contractType: "call",
    });
    expect(out.ok).toBe(true);
  });
});
