#!/usr/bin/env node
// Corre el monitoreo automático de planes paper abiertos (app/api/monitor,
// lib/planMonitor.ts) sin intervención manual: activa/cierra/expira solo.
// Lo lanza com.tito.monitor-plans.plist cada 15 min en horario de mercado.
// También se puede correr a mano: node scripts/monitor-auto.mjs
//
// Mismo patrón que scan-auto.mjs: Node y no bash (choque de TCC de macOS con
// /bin/bash sobre ~/Downloads), y sale en silencio fuera de horario de mercado
// (fines de semana, festivos, antes/después de horas — ver marketHours.mjs) —
// los planes con contrato de opciones no se mueven fuera de horas.

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";
import { enMercado } from "./marketHours.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
loadEnv({ path: path.join(ROOT, ".env.local") });

const DATA_DIR = path.join(ROOT, "data");
const LOG_FILE = path.join(DATA_DIR, "monitor-log.jsonl");

async function log(event, detail) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), event, detail }) + "\n";
  await fs.appendFile(LOG_FILE, line, "utf8");
}

async function main() {
  const now = new Date();
  if (!enMercado(now)) process.exit(0);

  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  const headers = user ? { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") } : {};

  const res = await fetch("http://localhost:3000/api/monitor", { headers }).catch(() => null);
  if (!res || !res.ok) {
    await log("error_conexion", "No se pudo conectar al servidor o la respuesta falló.");
    process.exit(0);
  }

  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  const last = lines[lines.length - 1]?.slice(6);
  if (!last) {
    await log("error", "Sin evento final del monitoreo.");
    process.exit(0);
  }

  let evento;
  try {
    evento = JSON.parse(last);
  } catch {
    await log("error", "No se pudo parsear la salida del monitoreo.");
    process.exit(0);
  }

  if (evento.type === "error") {
    await log("error", evento.message ?? "Error desconocido del monitoreo.");
    process.exit(0);
  }

  await log("monitoreo", {
    checked: evento.checked ?? 0,
    activated: (evento.activated ?? []).length,
    closed: (evento.closed ?? []).length,
    expired: (evento.expired ?? []).length,
    updatedHighest: evento.updatedHighest ?? 0,
    dataIssues: (evento.dataIssues ?? []).length,
  });
}

main().catch(async (err) => {
  await log("error", String(err?.message ?? err).slice(0, 500));
  process.exit(0);
});
