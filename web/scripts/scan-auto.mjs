#!/usr/bin/env node
// Corre un escaneo automático de oportunidades (Fase C) sin intervención manual:
// intradía o swing según el primer argumento. Antes era "bajo demanda" (botón
// "Escanear ahora" en /trades) a propósito, hasta que el usuario pidiera
// automatizarlo con launchd.
//
// Lo lanzan com.tito.scan-intraday.plist (cada 30 min) y com.tito.scan-swing.plist
// (cada 4h) — swing corre menos seguido porque su señal es persistencia en varios
// días, no frescura de minutos, así que escanearlo cada 30 min sería solo gastar
// llamadas sin ganar nada. También se puede correr a mano:
//   node scripts/scan-auto.mjs intraday
//   node scripts/scan-auto.mjs swing
//
// Es .mjs (Node) y no un script de bash a propósito: launchd invocando /bin/bash
// directo sobre un directorio de trabajo dentro de ~/Downloads choca con TCC de
// macOS ("Operation not permitted" al resolver el cwd — verificado en vivo, la
// misma carpeta funciona sin problema con /opt/homebrew/bin/node, que es lo que
// ya usa scripts/refresh-marketsnack-cookie.mjs). Mismo camino ya probado, no
// una solución nueva sin verificar.
//
// Fuera de horario de mercado (fines de semana, antes de apertura, después de
// cierre) sale en silencio sin llamar a la API — coste cero fuera de horas.
//
// Toda la lógica de detección/creación de planes/alertas vive en la ruta misma
// (app/api/scan/<horizonte>) — este script solo la dispara y registra qué pasó.

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
loadEnv({ path: path.join(ROOT, ".env.local") });

const HORIZONTE = process.argv[2];
const RUTA = HORIZONTE === "intraday" ? "intraday" : HORIZONTE === "swing" ? "swing" : null;
if (!RUTA) {
  console.error("Uso: node scripts/scan-auto.mjs intraday|swing");
  process.exit(1);
}

const DATA_DIR = path.join(ROOT, "data");
const LOG_FILE = path.join(DATA_DIR, `scan-${RUTA}-log.jsonl`);

async function log(event, detail) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), event, detail }) + "\n";
  await fs.appendFile(LOG_FILE, line, "utf8");
}

function enMercado(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const dow = get("weekday"); // "Mon".."Sun"
  const hm = Number(get("hour")) * 100 + Number(get("minute"));
  const esFinde = dow === "Sat" || dow === "Sun";
  return !esFinde && hm >= 930 && hm <= 1600;
}

async function main() {
  const now = new Date();
  if (!enMercado(now)) process.exit(0); // fuera de horario — coste cero, sin log

  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  const headers = user ? { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") } : {};

  const res = await fetch(`http://localhost:3000/api/scan/${RUTA}`, { headers }).catch(() => null);
  if (!res || !res.ok) {
    await log("error_conexion", "No se pudo conectar al servidor o la respuesta falló.");
    process.exit(0); // transitorio: el servidor puede estar caído, se reintenta en el próximo pase
  }

  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  const last = lines[lines.length - 1]?.slice(6);
  if (!last) {
    await log("error", "Sin evento final del escaneo.");
    process.exit(0);
  }

  let evento;
  try {
    evento = JSON.parse(last);
  } catch {
    await log("error", "No se pudo parsear la salida del escaneo.");
    process.exit(0);
  }

  if (evento.type === "error") {
    await log("error", evento.message ?? "Error desconocido del escaneo.");
    process.exit(0);
  }

  await log("escaneo", {
    created: (evento.created ?? []).length,
    rejectedByScore: (evento.rejectedByScore ?? []).length,
    rejectedByGuard: (evento.rejectedByGuard ?? []).length,
    dataIssues: (evento.dataIssues ?? []).length,
  });
}

main().catch(async (err) => {
  await log("error", String(err?.message ?? err).slice(0, 500));
  process.exit(0);
});
