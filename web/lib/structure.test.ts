import { describe, expect, it } from "vitest";
import {
  dominantStrikesScore, notionalScore, structureScore, volumeOverOIScore,
} from "./structure";
import type { Row } from "./types";

function row(over: Partial<Row> = {}): Row {
  const strike = over.strike ?? 100;
  const openInterest = over.openInterest ?? 1000;
  return {
    optionTicker: `T${Math.round(strike)}`,
    contractType: "call",
    expiration: "2026-09-18",
    strike,
    openInterest,
    volume: 0,
    price: 5,
    priceSource: "last_trade",
    bid: null, ask: null, mid: null,
    openPremium: 5 * openInterest,
    notionalValue: openInterest * 100 * strike,
    ...over,
  };
}

describe("Acumulación y Rapidez — tablas de puntuación", () => {
  it("valor nocional promedio", () => {
    expect(notionalScore(2_000_000_000)).toBe(10);
    expect(notionalScore(700_000_000)).toBe(10);
    expect(notionalScore(200_000_000)).toBe(8);
    expect(notionalScore(70_000_000)).toBe(6);
    expect(notionalScore(30_000_000)).toBe(4);
    expect(notionalScore(10_000_000)).toBe(2);
  });

  it("cantidad de strikes dominantes", () => {
    expect(dominantStrikesScore(6)).toBe(10);
    expect(dominantStrikesScore(5)).toBe(10);
    expect(dominantStrikesScore(3)).toBe(8);
    expect(dominantStrikesScore(1)).toBe(5);
    expect(dominantStrikesScore(0)).toBe(0);
  });

  it("volumen sobre open interest", () => {
    expect(volumeOverOIScore(100)).toBe(10);
    expect(volumeOverOIScore(80)).toBe(8);
    expect(volumeOverOIScore(50)).toBe(8);
    expect(volumeOverOIScore(40)).toBe(5);
    expect(volumeOverOIScore(10)).toBe(2);
  });
});

describe("structureScore", () => {
  it("agrupa el nocional por strike y calcula el promedio", () => {
    // 2 strikes: 100 (OI 1000 → $10M) y 200 (OI 1000 → $20M) → promedio $15M
    const s = structureScore([
      row({ strike: 100, openInterest: 1000 }),
      row({ strike: 200, openInterest: 1000 }),
    ]);
    expect(s.notional.strikeCount).toBe(2);
    expect(s.notional.total).toBe(30_000_000);
    expect(s.notional.avgPerStrike).toBe(15_000_000);
    expect(s.notional.points).toBe(2); // ≤ $25M
    expect(s.notional.lowLiquidity).toBe(true);
  });

  it("cuenta en cuántos de los top strikes domina un lado (calls o puts)", () => {
    // 5 strikes, todos claramente dominados por calls → 5 dominantes → 10 puntos
    const rows = [100, 110, 120, 130, 140].flatMap((strike) => [
      row({ strike, contractType: "call", openInterest: 1000 }),
      row({ strike, contractType: "put", openInterest: 50 }), // minoría
    ]);
    const s = structureScore(rows);
    expect(s.strikes.consideredCount).toBe(5);
    expect(s.strikes.dominantCount).toBe(5);
    expect(s.strikes.points).toBe(10);
    expect(s.strikes.dominantSide).toBe("calls");
  });

  it("un strike repartido 50/50 no cuenta como dominado", () => {
    const rows = [
      // 1 strike dominado por calls
      row({ strike: 100, contractType: "call", openInterest: 1000 }),
      row({ strike: 100, contractType: "put", openInterest: 10 }),
      // 2 strikes repartidos mitad y mitad
      row({ strike: 110, contractType: "call", openInterest: 500 }),
      row({ strike: 110, contractType: "put", openInterest: 500 }),
      row({ strike: 120, contractType: "call", openInterest: 500 }),
      row({ strike: 120, contractType: "put", openInterest: 500 }),
    ];
    const s = structureScore(rows);
    expect(s.strikes.dominantCount).toBe(1);
    expect(s.strikes.points).toBe(5);
  });

  it("sin dominancia en ningún strike → 0 puntos (sin visibilidad)", () => {
    const rows = [100, 110, 120].flatMap((strike) => [
      row({ strike, contractType: "call", openInterest: 500 }),
      row({ strike, contractType: "put", openInterest: 500 }),
    ]);
    expect(structureScore(rows).strikes.points).toBe(0);
  });

  it("identifica si dominan calls o puts", () => {
    const s = structureScore([
      row({ strike: 100, contractType: "call", openInterest: 3000 }),
      row({ strike: 110, contractType: "put", openInterest: 1000 }),
    ]);
    expect(s.strikes.dominantSide).toBe("calls");
    expect(s.strikes.callPct).toBeGreaterThan(s.strikes.putPct);
  });

  it("cuenta el % de contratos con volumen > open interest", () => {
    const s = structureScore([
      row({ strike: 100, openInterest: 10, volume: 500 }), // supera
      row({ strike: 110, openInterest: 10, volume: 500 }), // supera
      row({ strike: 120, openInterest: 1000, volume: 5 }), // no
      row({ strike: 130, openInterest: 1000, volume: 5 }), // no
    ]);
    expect(s.volOI.considered).toBe(4);
    expect(s.volOI.exceeded).toBe(2);
    expect(s.volOI.pct).toBe(50);
    expect(s.volOI.points).toBe(8);
  });

  it("ignora contratos sin actividad al medir volumen vs OI", () => {
    const s = structureScore([
      row({ strike: 100, openInterest: 0, volume: 0 }),
      row({ strike: 110, openInterest: 10, volume: 500 }),
    ]);
    expect(s.volOI.considered).toBe(1);
    expect(s.volOI.pct).toBe(100);
    expect(s.volOI.points).toBe(10);
  });

  it("resume los vencimientos más relevantes", () => {
    const s = structureScore([
      row({ strike: 100, expiration: "2026-09-18", openInterest: 10_000 }),
      row({ strike: 110, expiration: "2026-12-18", openInterest: 100 }),
    ]);
    expect(s.expirations[0].expiration).toBe("2026-09-18");
    expect(s.expirations[0].pctOfTotal).toBeGreaterThan(90);
  });

  it("cadena vacía devuelve cero", () => {
    expect(structureScore([]).score).toBe(0);
  });
});
