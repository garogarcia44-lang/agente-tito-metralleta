import { describe, expect, it } from "vitest";
import {
  aggressionOf, aggressionScore, classifyFlow, dedupeByContract, detectClusters,
  convictionScore, dominanceScore, executionLevel, executionScore,
  deltaScore, expiryScore, gammaScore, legScore, orderSizeScore, thetaScore,
  unusualityScore, unusualTradeScore,
  repetitionScore, spreadPct, spreadScore, timingScore, volumeScore, type RawTrade,
} from "./flow";

const NOW = new Date("2026-07-22T21:00:00Z");

function trade(overrides: Partial<RawTrade>): RawTrade {
  return {
    id: 1,
    symbol: "TSLA261120P00305000",
    price: 11.7,
    size: 1,
    side: "ASKSIDE",
    bid_price: 11.55,
    ask_price: 11.75,
    premium: 1170,
    delta: -0.18,
    implied_volatility: 0.48,
    open_interest: 1556,
    volume: 1046,
    score: 50,
    sentiment: "bearish",
    timestamp: "2026-07-22T19:59:59.994Z",
    ...overrides,
  };
}

describe("aggressionOf", () => {
  it("mapea los lados de MarketSnack", () => {
    expect(aggressionOf("ASKSIDE")).toBe("ask");
    expect(aggressionOf("ABOVE_ASK")).toBe("ask");
    expect(aggressionOf("AT_ASK")).toBe("ask");
    expect(aggressionOf("BELOW_BID")).toBe("bid");
    expect(aggressionOf("AT_BID")).toBe("bid");
    expect(aggressionOf("MIDMKT")).toBe("mid");
    expect(aggressionOf("???")).toBe("unknown");
  });
});

describe("classifyFlow", () => {
  it("parsea el contrato y arma la fila", () => {
    const { rows } = classifyFlow([trade({ id: 1 })], NOW);
    const r = rows[0];
    expect(r.underlying).toBe("TSLA");
    expect(r.type).toBe("put");
    expect(r.strike).toBe(305);
    expect(r.expiration).toBe("2026-11-20");
    expect(r.dte).toBe(121);
    expect(r.aggression).toBe("ask");
  });

  it("marca big (≥$1M) e interesante", () => {
    const { rows } = classifyFlow([trade({ id: 1, premium: 2_000_000 })], NOW);
    expect(rows[0].flags.big).toBe(true);
    expect(rows[0].interesting).toBe(true);
  });

  it("marca convDelta (≥$100K y |Δ|>.60)", () => {
    const { rows } = classifyFlow(
      [trade({ id: 1, premium: 150_000, delta: -0.7 })],
      NOW,
    );
    expect(rows[0].flags.convDelta).toBe(true);
    expect(rows[0].interesting).toBe(true);
  });

  it("descarta los MIDMKT del set interesante", () => {
    const { rows } = classifyFlow(
      [trade({ id: 1, side: "MIDMKT", premium: 5_000_000 })],
      NOW,
    );
    expect(rows[0].flags.mid).toBe(true);
    expect(rows[0].interesting).toBe(false); // mid se descarta aunque sea grande
  });

  it("un above-ask por debajo del piso no es interesante; por encima sí", () => {
    const low = classifyFlow([trade({ id: 1, premium: 1_000 })], NOW);
    expect(low.rows[0].interesting).toBe(false);
    const high = classifyFlow([trade({ id: 1, premium: 60_000 })], NOW);
    expect(high.rows[0].interesting).toBe(true);
  });

  it("marca leap por DTE largo", () => {
    const { rows } = classifyFlow([trade({ id: 1 })], NOW); // DTE 121
    expect(rows[0].flags.leap).toBe(true);
  });

  it("detecta repetidas (≥3 mismo contrato+lado en 5 min)", () => {
    const base = "2026-07-22T19:50:00.000Z";
    const mk = (i: number, secs: number) =>
      trade({ id: i, timestamp: new Date(Date.parse(base) + secs * 1000).toISOString() });
    const { rows } = classifyFlow([mk(1, 0), mk(2, 30), mk(3, 60)], NOW);
    expect(rows.every((r) => r.flags.repeated)).toBe(true);
  });

  it("no marca repetidas si están fuera de la ventana de 5 min", () => {
    const mk = (i: number, secs: number) =>
      trade({ id: i, timestamp: new Date(Date.parse("2026-07-22T19:00:00Z") + secs * 1000).toISOString() });
    const { rows } = classifyFlow([mk(1, 0), mk(2, 600), mk(3, 1200)], NOW);
    expect(rows.some((r) => r.flags.repeated)).toBe(false);
  });

  it("detecta ejecuciones simultáneas (mismo timestamp, distintos contratos)", () => {
    const ts = "2026-07-22T19:30:00.000Z";
    const a = trade({ id: 1, symbol: "TSLA261120P00305000", timestamp: ts });
    const b = trade({ id: 2, symbol: "TSLA261120C00320000", timestamp: ts });
    const { rows } = classifyFlow([a, b], NOW);
    expect(rows[0].flags.simultaneous).toBe(true);
    expect(rows[1].flags.simultaneous).toBe(true);
    // simultáneo ≠ multileg: eso lo decide la condición OPRA
    expect(rows[0].flags.multileg).toBe(false);
  });

  it("multileg sale de la condición OPRA, no del timestamp", () => {
    const mlet = classifyFlow([trade({ id: 1, trade_condition_id: 232 })], NOW).rows[0]; // MLET
    expect(mlet.flags.multileg).toBe(true);
    expect(mlet.conditionCode).toBe("MLET");

    const slan = classifyFlow([trade({ id: 2, trade_condition_id: 227 })], NOW).rows[0]; // SLAN
    expect(slan.flags.multileg).toBe(false);
    expect(slan.conditionCode).toBe("SLAN");

    // MESL/MFSL se ejecutan "against single leg(s)" → MarketSnack los trata como single
    const mesl = classifyFlow([trade({ id: 3, trade_condition_id: 236 })], NOW).rows[0];
    expect(mesl.flags.multileg).toBe(false);
  });

  it("descarta transacciones canceladas (la orden se anuló)", () => {
    const { rows } = classifyFlow([
      trade({ id: 1, trade_condition_id: 201 }), // CANC
      trade({ id: 2, trade_condition_id: 203 }), // CNCL
      trade({ id: 3, trade_condition_id: 205 }), // CNCO
      trade({ id: 4, trade_condition_id: 207 }), // CNOL
      trade({ id: 5, trade_condition_id: 231 }), // SLFT → válida
    ], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(5);
    expect(rows[0].conditionCode).toBe("SLFT");
  });

  it("single leg puntúa 10 y multi leg 5 en Inusualidad", () => {
    const single = classifyFlow([trade({ id: 1, trade_condition_id: 227 })], NOW).rows[0];
    const multi = classifyFlow([trade({ id: 2, trade_condition_id: 232 })], NOW).rows[0];
    expect(unusualTradeScore(single).leg).toBe(10);
    expect(unusualTradeScore(multi).leg).toBe(5);
  });

  it("ordena el set interesante por premium desc", () => {
    const { interesting } = classifyFlow(
      [
        trade({ id: 1, premium: 60_000 }),
        trade({ id: 2, premium: 2_000_000 }),
        trade({ id: 3, premium: 500_000 }),
      ],
      NOW,
    );
    expect(interesting.map((r) => r.premium)).toEqual([2_000_000, 500_000, 60_000]);
  });
});

describe("dedupeByContract", () => {
  it("se queda con el trade de mayor premium por símbolo", () => {
    const raw = [
      trade({ id: 1, symbol: "TSLA261120P00305000", premium: 1170 }),
      trade({ id: 2, symbol: "TSLA261120P00305000", premium: 50000 }),
      trade({ id: 3, symbol: "AAPL261120C00200000", premium: 8000 }),
    ];
    const { rows } = classifyFlow(raw, NOW);
    const deduped = dedupeByContract(rows);
    expect(deduped).toHaveLength(2);
    const tsla = deduped.find((r) => r.symbol === "TSLA261120P00305000");
    expect(tsla?.id).toBe(2);
  });

  it("no toca las filas si ya hay una sola por contrato", () => {
    const raw = [trade({ id: 1, symbol: "TSLA261120P00305000" })];
    const { rows } = classifyFlow(raw, NOW);
    expect(dedupeByContract(rows)).toHaveLength(1);
  });
});

describe("aggressionScore", () => {
  const mk = (id: number, side: string, premium: number) =>
    classifyFlow([trade({ id, side, premium })], NOW).rows[0];

  it("todo al ask → 10", () => {
    const s = aggressionScore([mk(1, "ASKSIDE", 1_000_000), mk(2, "AT_ASK", 500_000)]);
    expect(s.score).toBe(10);
    expect(s.premiumAsk).toBe(1_500_000);
    expect(s.premiumBid).toBe(0);
  });

  it("todo al bid → 0", () => {
    const s = aggressionScore([mk(1, "BIDSIDE", 800_000)]);
    expect(s.score).toBe(0);
    expect(s.ratio).toBe(0);
  });

  it("mitad y mitad → 5, ignora mid", () => {
    const s = aggressionScore([
      mk(1, "ASKSIDE", 500_000),
      mk(2, "BIDSIDE", 500_000),
      mk(3, "MIDMKT", 9_000_000),
    ]);
    expect(s.score).toBe(5);
    expect(s.premiumMid).toBe(9_000_000);
  });

  it("sin flujo ask/bid → 0", () => {
    const s = aggressionScore([mk(1, "MIDMKT", 100_000)]);
    expect(s.score).toBe(0);
  });
});

describe("volumeScore", () => {
  it("puntúa por número de contratos", () => {
    expect(volumeScore(200, 0)).toBe(10);
    expect(volumeScore(150, 0)).toBe(10);
    expect(volumeScore(120, 0)).toBe(8);
    expect(volumeScore(60, 0)).toBe(6);
    expect(volumeScore(25, 0)).toBe(4);
    expect(volumeScore(10, 600_000)).toBe(1); // <20 pero >$500k
    expect(volumeScore(10, 100_000)).toBe(0); // <20 y ≤$500k
  });
});

describe("timingScore", () => {
  const at = (etHour: number, etMin: number) => {
    // 2026-07-22 es horario de verano (EDT, UTC-4)
    const utcH = etHour + 4;
    return `2026-07-22T${String(utcH).padStart(2, "0")}:${String(etMin).padStart(2, "0")}:00Z`;
  };
  it("mediodía 11:00–13:00 → 10", () => { expect(timingScore(at(12, 0))).toBe(10); });
  it("apertura 9:30–10:30 → 7", () => { expect(timingScore(at(10, 0))).toBe(7); });
  it("cierre 15:00–16:00 → 6", () => { expect(timingScore(at(15, 30))).toBe(6); });
  it("otros horarios → 3", () => { expect(timingScore(at(14, 0))).toBe(3); });
});

describe("repetitionScore", () => {
  it("puntúa por repeticiones del mismo strike", () => {
    expect(repetitionScore(5)).toBe(10);
    expect(repetitionScore(3)).toBe(10);
    expect(repetitionScore(2)).toBe(7);
    expect(repetitionScore(1)).toBe(4);
    expect(repetitionScore(0)).toBe(1);
  });
});

describe("scoreRows via classifyFlow", () => {
  it("suma los 3 sub-scores y marca inusual, y flag exceededOI", () => {
    const t = (over: Partial<RawTrade>): RawTrade => trade({
      symbol: "TSLA260918C00350000", size: 200, volume: 5000, open_interest: 100,
      timestamp: "2026-07-22T16:00:00Z", // 12:00 ET → timing 10
      ...over,
    });
    // 3 trades mismo contrato → repetition 10; size 200 → volume 10; timing 10 → total 30
    const { rows } = classifyFlow([t({ id: 1 }), t({ id: 2 }), t({ id: 3 })], NOW);
    expect(rows[0].scores).toEqual({ volume: 10, timing: 10, repetition: 10, total: 30 });
    expect(rows[0].unusual).toBe(true);
    expect(rows[0].flags.exceededOI).toBe(true); // volume 5000 > OI 100
  });
});

describe("Estado de expiración (vs hoy)", () => {
  // NOW = 2026-07-22
  const withExp = (symbol: string) => classifyFlow([trade({ symbol })], NOW).rows[0];

  it("marca expirado si el vencimiento ya pasó", () => {
    expect(withExp("TSLA260710P00305000").expiryStatus).toBe("expirado"); // 2026-07-10
  });

  it("marca expira_hoy si vence hoy", () => {
    expect(withExp("TSLA260722P00305000").expiryStatus).toBe("expira_hoy"); // 2026-07-22
  });

  it("marca vigente si aún no vence", () => {
    expect(withExp("TSLA261120P00305000").expiryStatus).toBe("vigente"); // 2026-11-20
  });

  it("desconocido si el símbolo no es OCC válido", () => {
    expect(withExp("RARO").expiryStatus).toBe("desconocido");
  });
});

describe("Convicción — spread", () => {
  it("calcula el spread relativo sobre el mid", () => {
    expect(spreadPct(9.9, 10.1)).toBeCloseTo(2); // 0.2 / 10 = 2%
    expect(spreadPct(0, 5)).toBeNull();
  });

  it("puntúa según la tabla del documento", () => {
    expect(spreadScore(1.5)).toBe(10);
    expect(spreadScore(2)).toBe(7);
    expect(spreadScore(5)).toBe(7);
    expect(spreadScore(8)).toBe(4);
    expect(spreadScore(10)).toBe(4);
    expect(spreadScore(15)).toBe(0); // >10% se aparta
    expect(spreadScore(null)).toBe(0);
  });
});

describe("Convicción — dominancia ASK vs BID", () => {
  it("puntúa según la escala", () => {
    expect(dominanceScore(85)).toBe(10);
    expect(dominanceScore(80)).toBe(10);
    expect(dominanceScore(75)).toBe(8);
    expect(dominanceScore(65)).toBe(6);
    expect(dominanceScore(57)).toBe(4);
    expect(dominanceScore(52)).toBe(2);
    expect(dominanceScore(49)).toBe(0);
  });
});

describe("Convicción — fuerza de ejecución", () => {
  it("clasifica el nivel según dónde cayó el precio", () => {
    expect(executionLevel(10.5, 9, 10, "ASKSIDE")).toBe("above_ask");
    expect(executionLevel(8.5, 9, 10, "BIDSIDE")).toBe("below_bid");
    expect(executionLevel(10, 9, 10, "AT_ASK")).toBe("at_ask");
    expect(executionLevel(9, 9, 10, "AT_BID")).toBe("at_bid");
    expect(executionLevel(9.9, 9, 10, "ASKSIDE")).toBe("near");
    expect(executionLevel(9.5, 9, 10, "MIDMKT")).toBe("mid");
    expect(executionLevel(5, 0, 0, "MIDMKT")).toBe("unclear");
  });

  it("puntúa de más a menos agresivo", () => {
    expect(executionScore("above_ask")).toBe(10);
    expect(executionScore("below_bid")).toBe(10);
    expect(executionScore("at_ask")).toBe(8);
    expect(executionScore("near")).toBe(6);
    expect(executionScore("mid")).toBe(3);
    expect(executionScore("unclear")).toBe(0);
  });
});

describe("convictionScore", () => {
  const mk = (over: Partial<RawTrade>) =>
    classifyFlow([trade({ bid_price: 9.9, ask_price: 10.1, price: 10.2, ...over })], NOW).rows[0];

  it("flujo decidido: spread estrecho + un solo lado + sobre el ask → 10", () => {
    const rows = [
      mk({ id: 1, side: "ASKSIDE", premium: 1_000_000 }),
      mk({ id: 2, side: "ASKSIDE", premium: 1_000_000 }),
    ];
    const s = convictionScore(rows);
    expect(s.spread.points).toBe(10); // 2% → cae en <2%? no: exactamente 2 → 7
    expect(s.dominance.dominantPct).toBe(100);
    expect(s.dominance.points).toBe(10);
    expect(s.execution.points).toBe(10); // above_ask
    expect(s.score).toBe(10);
  });

  it("flujo dividido y en el medio baja el score", () => {
    const rows = [
      mk({ id: 1, side: "ASKSIDE", premium: 500_000, price: 10.0 }),
      mk({ id: 2, side: "BIDSIDE", premium: 500_000, price: 10.0 }),
    ];
    const s = convictionScore(rows);
    expect(s.dominance.dominantPct).toBe(50);
    expect(s.dominance.points).toBe(2);
    expect(s.execution.counts.mid).toBe(2);
    expect(s.score).toBeLessThan(7);
  });

  it("separa spreads anchos y alerta si superan $1M", () => {
    const rows = [
      mk({ id: 1, side: "ASKSIDE", premium: 2_000_000, bid_price: 1, ask_price: 3, price: 3.5 }), // 100%
      mk({ id: 2, side: "ASKSIDE", premium: 100_000, bid_price: 1, ask_price: 3, price: 3.5 }),
    ];
    const s = convictionScore(rows);
    expect(s.spread.wideCount).toBe(2);
    expect(s.spread.wideAlert).toHaveLength(1); // solo el de $2M alerta
    expect(s.spread.wideAlert[0].premium).toBe(2_000_000);
  });

  it("sin trades → todo en cero", () => {
    const s = convictionScore([]);
    expect(s.score).toBe(0);
    expect(s.dominance.points).toBe(0);
  });
});

describe("Inusualidad — tabla de puntuación", () => {
  it("tamaño de órdenes", () => {
    expect(orderSizeScore(6_000_000)).toBe(10);
    expect(orderSizeScore(2_000_000)).toBe(8);
    expect(orderSizeScore(700_000)).toBe(7);
    expect(orderSizeScore(300_000)).toBe(5);
    expect(orderSizeScore(150_000)).toBe(3);
    expect(orderSizeScore(50_000)).toBe(0);
  });

  it("delta usa el valor absoluto (los puts también cuentan)", () => {
    expect(deltaScore(0.9)).toBe(10);
    expect(deltaScore(-0.9)).toBe(10);
    expect(deltaScore(0.75)).toBe(8);
    expect(deltaScore(-0.65)).toBe(7);
    expect(deltaScore(0.55)).toBe(5);
    expect(deltaScore(0.3)).toBe(0);
  });

  it("theta como % de decaimiento diario", () => {
    expect(thetaScore(0.5)).toBe(10);
    expect(thetaScore(2)).toBe(8);
    expect(thetaScore(4)).toBe(5);
    expect(thetaScore(9)).toBe(0);
    expect(thetaScore(null)).toBe(0);
  });

  it("gamma: la zona institucional 0.01–0.08 puntúa alto", () => {
    expect(gammaScore(0.02)).toBe(10);
    expect(gammaScore(0.05)).toBe(10);
    expect(gammaScore(0.1)).toBe(8);
    expect(gammaScore(0.3)).toBe(4);
    expect(gammaScore(0.005)).toBe(2);
  });

  it("single leg vale más que multileg", () => {
    expect(legScore(false)).toBe(10);
    expect(legScore(true)).toBe(5);
  });

  it("vencimiento: los LEAPs puntúan alto", () => {
    expect(expiryScore(320)).toBe(10);
    expect(expiryScore(120)).toBe(10);
    expect(expiryScore(95)).toBe(8);
    expect(expiryScore(60)).toBe(7);
    expect(expiryScore(30)).toBe(5);
    expect(expiryScore(7)).toBe(2);
    expect(expiryScore(null)).toBe(0);
  });
});

describe("unusualTradeScore / unusualityScore", () => {
  // LEAP grande, delta alto, theta bajo, gamma institucional, single leg
  const institucional = (over: Partial<RawTrade> = {}) =>
    classifyFlow([trade({
      symbol: "TSLA271217C00300000", // vence 2027-12-17 → LEAP
      premium: 6_000_000, delta: 0.85, gamma: 0.03, theta: -0.05, price: 100,
      ...over,
    })], NOW).rows[0];

  it("un trade institucional puntúa 10 en todo", () => {
    const s = unusualTradeScore(institucional());
    expect(s).toMatchObject({ size: 10, delta: 10, theta: 10, gamma: 10, leg: 10, expiry: 10 });
    expect(s.total).toBe(10);
  });

  it("un trade chico y de corto plazo puntúa bajo", () => {
    const row = classifyFlow([trade({
      symbol: "TSLA260724C00300000", // vence en 2 días
      premium: 120_000, delta: 0.2, gamma: 0.005, theta: -8, price: 100,
    })], NOW).rows[0];
    const s = unusualTradeScore(row);
    expect(s.size).toBe(3);
    expect(s.delta).toBe(0);
    expect(s.expiry).toBe(2);
    expect(s.total).toBeLessThan(5);
  });

  it("la categoría pondera por premium y cuenta los inusuales", () => {
    const grande = institucional({ id: 1 });
    const chico = classifyFlow([trade({
      id: 2, symbol: "TSLA260724C00300000", premium: 100_000,
      delta: 0.1, gamma: 0.005, theta: -9, price: 100,
    })], NOW).rows[0];
    const s = unusualityScore([grande, chico]);
    expect(s.n).toBe(2);
    expect(s.unusualCount).toBe(1); // solo el institucional pasa el umbral
    expect(s.score).toBeGreaterThanOrEqual(9); // el de $6M domina la ponderación
    expect(s.top[0].row.id).toBe(1);
  });

  it("sin trades devuelve cero", () => {
    expect(unusualityScore([]).score).toBe(0);
  });
});

describe("detectClusters", () => {
  const base = Date.parse("2026-07-22T15:00:00Z");
  const row = (id: number, side: string, premium: number, secOffset: number) =>
    classifyFlow([trade({ id, side, premium, timestamp: new Date(base + secOffset * 1000).toISOString() })], NOW).rows[0];

  it("agrupa un burst de ≥3 trades con premium ≥ $500K", () => {
    const rows = [row(1, "ASKSIDE", 300_000, 0), row(2, "ASKSIDE", 300_000, 60), row(3, "ASKSIDE", 300_000, 120)];
    const cl = detectClusters(rows);
    expect(cl.length).toBe(1);
    expect(cl[0].count).toBe(3);
    expect(cl[0].direction).toBe("ask");
    expect(cl[0].premium).toBe(900_000);
  });

  it("no forma racimo si el premium acumulado es bajo", () => {
    const rows = [row(1, "ASKSIDE", 50_000, 0), row(2, "ASKSIDE", 50_000, 60), row(3, "ASKSIDE", 50_000, 120)];
    expect(detectClusters(rows).length).toBe(0);
  });

  it("no forma racimo con menos de 3 trades", () => {
    const rows = [row(1, "ASKSIDE", 400_000, 0), row(2, "ASKSIDE", 400_000, 60)];
    expect(detectClusters(rows).length).toBe(0);
  });

  it("separa en dos racimos si hay un gap > 5 min", () => {
    const rows = [
      row(1, "ASKSIDE", 300_000, 0), row(2, "ASKSIDE", 300_000, 60), row(3, "ASKSIDE", 300_000, 120),
      row(4, "BIDSIDE", 300_000, 600), row(5, "BIDSIDE", 300_000, 660), row(6, "BIDSIDE", 300_000, 720),
    ];
    const cl = detectClusters(rows);
    expect(cl.length).toBe(2);
    expect(cl[0].direction).toBe("ask");
    expect(cl[1].direction).toBe("bid");
  });

  it("dirección = lado con más premium; unidireccionalidad refleja la mezcla", () => {
    const rows = [row(1, "ASKSIDE", 800_000, 0), row(2, "BIDSIDE", 200_000, 60), row(3, "ASKSIDE", 200_000, 120)];
    const cl = detectClusters(rows);
    expect(cl[0].direction).toBe("ask");
    expect(cl[0].unidirectionality).toBeCloseTo(1000000 / 1200000);
  });

  it("comprar PUTS al ask = apuesta bajista (no alcista)", () => {
    // el trade base es un put (TSLA...P00305000) comprado al ask
    const rows = [row(1, "ASKSIDE", 300_000, 0), row(2, "ASKSIDE", 300_000, 60), row(3, "ASKSIDE", 300_000, 120)];
    const cl = detectClusters(rows);
    expect(cl[0].direction).toBe("ask");
    expect(cl[0].bet).toBe("bajista");
    expect(cl[0].betLabel).toBe("Compraron PUTS");
    expect(cl[0].putPremium).toBe(900_000);
  });

  it("comprar CALLS al ask = apuesta alcista", () => {
    const call = (id: number, secs: number) =>
      classifyFlow([trade({ id, side: "ASKSIDE", premium: 300_000, symbol: "TSLA261120C00400000", timestamp: new Date(Date.parse("2026-07-22T15:00:00Z") + secs * 1000).toISOString() })], NOW).rows[0];
    const cl = detectClusters([call(1, 0), call(2, 60), call(3, 120)]);
    expect(cl[0].bet).toBe("alcista");
    expect(cl[0].betLabel).toBe("Compraron CALLS");
  });
});
