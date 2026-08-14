import { describe, expect, it, beforeAll } from "vitest";
import { createSessionToken, verifySessionToken, MAX_AGE_MS } from "./session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-no-usar-en-produccion";
});

const NOW = new Date("2026-08-14T00:00:00Z");

describe("createSessionToken / verifySessionToken", () => {
  it("un token recién creado es válido", () => {
    const token = createSessionToken(NOW);
    expect(verifySessionToken(token, NOW)).toBe(true);
  });

  it("sigue válido justo antes de expirar", () => {
    const token = createSessionToken(NOW);
    const justBefore = new Date(NOW.getTime() + MAX_AGE_MS - 1000);
    expect(verifySessionToken(token, justBefore)).toBe(true);
  });

  it("ya no es válido después de expirar", () => {
    const token = createSessionToken(NOW);
    const after = new Date(NOW.getTime() + MAX_AGE_MS + 1000);
    expect(verifySessionToken(token, after)).toBe(false);
  });

  it("rechaza null/undefined/vacío", () => {
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
    expect(verifySessionToken("")).toBe(false);
  });

  it("rechaza un token manipulado (firma no coincide)", () => {
    const token = createSessionToken(NOW);
    const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(verifySessionToken(tampered, NOW)).toBe(false);
  });

  it("rechaza un token sin el separador de firma", () => {
    expect(verifySessionToken("sin-punto-ni-firma", NOW)).toBe(false);
  });

  it("rechaza un token con la fecha de expiración alterada sin resfirmar", () => {
    const token = createSessionToken(NOW);
    const dot = token.lastIndexOf(".");
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const [, expires] = payload.split(":");
    const forgedPayload = `v1:${Number(expires) + 1_000_000_000}`;
    const forged = `${forgedPayload}.${sig}`;
    expect(verifySessionToken(forged, NOW)).toBe(false);
  });

  it("rechaza una firma de otro secreto", () => {
    const token = createSessionToken(NOW);
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "otro-secreto-distinto";
    const forged = createSessionToken(NOW);
    process.env.SESSION_SECRET = original;
    expect(verifySessionToken(forged, NOW)).toBe(false);
  });
});
