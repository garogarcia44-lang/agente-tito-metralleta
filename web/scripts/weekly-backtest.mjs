#!/usr/bin/env node
// Corre /api/backtest?apply=true una vez a la semana — a diferencia de correrlo
// a mano desde el navegador, esto además APLICA sin pedir aprobación cualquier
// umbral que lib/backtestRuleSelection.ts considere confiable (Jorge autorizó
// explícitamente saltar la aprobación humana solo para este camino,
// 2026-08-14). Lo lanza com.tito.weekly-backtest.plist, viernes después del
// cierre del mercado. También se puede correr a mano:
//   node scripts/weekly-backtest.mjs
//
// Node y no bash, por el choque de TCC de macOS con /bin/bash sobre una
// carpeta dentro de ~/Downloads (mismo motivo que scan-auto.mjs/snapshot-chains.mjs).

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
loadEnv({ path: path.join(ROOT, ".env.local") });

const DATA_DIR = path.join(ROOT, "data");
const LOG_FILE = path.join(DATA_DIR, "weekly-backtest-log.jsonl");

async function log(event, detail) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), event, detail }) + "\n";
  await fs.appendFile(LOG_FILE, line, "utf8");
}

async function main() {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  const headers = user ? { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") } : {};

  const res = await fetch("http://localhost:3000/api/backtest?apply=true", {
    headers,
    signal: AbortSignal.timeout(20 * 60 * 1000), // el backtest recorre todos los tickers guardados, puede tardar
  }).catch((err) => {
    log("error_conexion", String(err?.message ?? err).slice(0, 300));
    return null;
  });
  if (!res || !res.ok) {
    if (res) await log("error_conexion", `Servidor respondió ${res.status}.`);
    process.exit(0); // transitorio: se reintenta la próxima semana
  }

  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  const last = lines[lines.length - 1]?.slice(6);
  if (!last) {
    await log("error", "Sin evento final.");
    process.exit(0);
  }

  let evento;
  try {
    evento = JSON.parse(last);
  } catch {
    await log("error", "No se pudo parsear la salida.");
    process.exit(0);
  }

  if (evento.type === "error") {
    await log("error", evento.message ?? "Error desconocido.");
    process.exit(0);
  }

  await log("backtest", {
    tickersProcessed: evento.tickersProcessed,
    totalCandidates: evento.totalCandidates,
    applied: evento.applied ?? [],
  });
}

main().catch(async (err) => {
  await log("error", String(err?.message ?? err).slice(0, 500));
  process.exit(0);
});
