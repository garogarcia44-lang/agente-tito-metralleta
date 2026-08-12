import { describe, expect, it } from "vitest";
import { activatePlan, createPaperPlan, type PaperPlan } from "./paperPlan";
import { alertId, buildAlertMessage } from "./paperAlert";

const NOW = new Date("2026-08-12T14:00:00Z");

function plan(): PaperPlan {
  return createPaperPlan(
    {
      id: "plan-1", ticker: "aapl", contractType: "call", strike: 230,
      expiration: "2026-09-18", symbol: "AAPL260918C00230000", strategy: "long_call",
      horizon: "swing", trigger: 5, target: 8, initialStop: 3, contracts: 2,
      estimatedProbability: 60,
    },
    NOW,
  );
}

describe("buildAlertMessage", () => {
  it("siempre empieza con el encabezado fijo y termina con el disclaimer fijo", () => {
    const { text } = buildAlertMessage({ plan: plan(), event: "created" });
    expect(text.startsWith("⚠️ TITO METRALLETA — SIMULACIÓN / PAPER TRADING")).toBe(true);
    expect(text).toContain(
      "Esto no es una orden ni asesoría financiera. Tito Metralleta no opera en tu bróker.",
    );
  });

  it("incluye ticker/contrato, call o put, strike/vencimiento, horizonte, gatillo/objetivo/stop y probabilidad", () => {
    const { text } = buildAlertMessage({ plan: plan(), event: "created" });
    expect(text).toContain("AAPL $230.00C");
    expect(text).toContain("Call o put: Call");
    expect(text).toContain("$230.00 · vence 2026-09-18");
    expect(text).toContain("Tipo de oportunidad: Swing");
    expect(text).toContain("Gatillo: $5.00");
    expect(text).toContain("Objetivo: $8.00");
    expect(text).toContain("Probabilidad estimada: 60%");
  });

  it("incluye el precio observado y su hora cuando se dan", () => {
    const { text } = buildAlertMessage({
      plan: plan(), event: "activated", observedPrice: 5.1, observedAt: "2026-08-12T14:05:00Z",
    });
    expect(text).toContain("Precio observado y hora: $5.10");
  });

  it("usa un guion cuando falta el precio observado", () => {
    const { text } = buildAlertMessage({ plan: plan(), event: "created" });
    expect(text).toContain("Precio observado y hora: — ·");
  });

  it("incluye los factores principales cuando se pasan", () => {
    const { text } = buildAlertMessage({
      plan: plan(), event: "created", factors: ["Flujo inusual", "GEX concentrado en el strike"],
    });
    expect(text).toContain("Factores principales: Flujo inusual · GEX concentrado en el strike");
  });

  it("cae a las notas del plan si no se pasan factores explícitos", () => {
    const p = { ...plan(), notes: "Nota del creador" };
    const { text } = buildAlertMessage({ plan: p, event: "created" });
    expect(text).toContain("Factores principales: Nota del creador");
  });

  it("incluye el motivo cuando el evento es data_issue", () => {
    const { text } = buildAlertMessage({ plan: plan(), event: "data_issue", note: "Cotización atrasada 20 min." });
    expect(text).toContain("Motivo: Cotización atrasada 20 min.");
  });

  it("siempre incluye un identificador de alerta", () => {
    const { text, id } = buildAlertMessage({ plan: plan(), event: "created" });
    expect(text).toContain(`Identificador de la alerta: ${id}`);
  });
});

describe("alertId", () => {
  it("es estable para el mismo plan y evento", () => {
    const p = plan();
    expect(alertId({ plan: p, event: "created" })).toBe(alertId({ plan: p, event: "created" }));
  });

  it("distingue eventos distintos del mismo plan", () => {
    const p = plan();
    expect(alertId({ plan: p, event: "created" })).not.toBe(alertId({ plan: p, event: "activated" }));
  });

  it("para stop_raised incluye el valor del stop, así cada subida es una alerta distinta", () => {
    const p1 = plan();
    const active = activatePlan(p1, { price: 5, source: "manual", at: "2026-08-12T14:05:00Z" }, NOW);
    const raisedTo4 = { ...active, dynamicStop: 4 };
    const raisedTo5 = { ...active, dynamicStop: 5 };
    expect(alertId({ plan: raisedTo4, event: "stop_raised" })).not.toBe(
      alertId({ plan: raisedTo5, event: "stop_raised" }),
    );
  });
});
