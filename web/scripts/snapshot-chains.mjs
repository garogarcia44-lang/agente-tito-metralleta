#!/usr/bin/env node
// Corre /api/chain-snapshot una vez al día — guarda la cadena de opciones de
// HOY de TODOS los tickers rastreados (no solo los ~6 del escaneo normal).
// Lo lanza com.tito.chain-snapshot.plist, cerca de la apertura del mercado,
// entre semana. También se puede correr a mano:
//   node scripts/snapshot-chains.mjs
//
// Es pesado (hasta ~95 tickers × 20 requests cada uno, con el throttle de
// MarketSnack) — por eso solo una vez al día, no cada 30 min como los
// escaneos normales. Igual que scan-auto.mjs: Node y no bash, por el choque
// de TCC de macOS con /bin/bash sobre una carpeta dentro de ~/Downloads.

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
loadEnv({ path: path.join(ROOT, ".env.local") });

const DATA_DIR = path.join(ROOT, "data");
const LOG_FILE = path.join(DATA_DIR, "chain-snapshot-log.jsonl");

async function log(event, detail) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), event, detail }) + "\n";
  await fs.appendFile(LOG_FILE, line, "utf8");
}

function esDiaHabil(now) {
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(now);
  return dow !== "Sat" && dow !== "Sun";
}

async function main() {
  if (!esDiaHabil(new Date())) process.exit(0); // fin de semana — coste cero, sin log

  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  const headers = user ? { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") } : {};

  const res = await fetch("http://localhost:3000/api/chain-snapshot", {
    headers,
    signal: AbortSignal.timeout(40 * 60 * 1000), // hasta 40 min — puede tardar
  }).catch((err) => {
    log("error_conexion", String(err?.message ?? err).slice(0, 300));
    return null;
  });
  if (!res || !res.ok) {
    if (res) await log("error_conexion", `Servidor respondió ${res.status}.`);
    process.exit(0); // transitorio: se reintenta mañana
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

  await log("snapshot", {
    tickersTotal: evento.tickersTotal, saved: evento.saved, failed: (evento.failed ?? []).length,
  });
}

main().catch(async (err) => {
  await log("error", String(err?.message ?? err).slice(0, 500));
  process.exit(0);
});
