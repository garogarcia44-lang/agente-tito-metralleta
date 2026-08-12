// Bitácora de alertas de WhatsApp — data/alert-log.jsonl (gitignored), append-only,
// mismo espíritu que data/sync-log.jsonl del sync de Robinhood. Sirve para dos cosas:
// (1) no mandar la misma alerta dos veces, (2) poder auditar qué se avisó y cuándo.
// Solo servidor.

import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "alert-log.jsonl");

export interface AlertLogEntry {
  id: string;
  planId: string;
  event: string;
  at: string;
  sent: boolean;
  reason?: string;
  sid?: string;
}

async function readAll(): Promise<AlertLogEntry[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as AlertLogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is AlertLogEntry => e !== null);
  } catch {
    return [];
  }
}

/** true solo si esa alerta ya se mandó de verdad (sent:true) — un intento fallido no cuenta. */
export async function wasAlertSent(id: string): Promise<boolean> {
  const entries = await readAll();
  return entries.some((e) => e.id === id && e.sent);
}

export async function appendAlertLog(entry: AlertLogEntry): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.appendFile(FILE, `${JSON.stringify(entry)}\n`, "utf8");
}
