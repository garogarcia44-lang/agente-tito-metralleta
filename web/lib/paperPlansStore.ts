// Persistencia de los planes paper ("Mis Trades"). web/data/paperplans.json (gitignored).
// Solo servidor. La lógica de la máquina de estados vive en `paperPlan.ts`, pura.
//
// Un solo archivo global (no por ticker) porque "Mis Trades" muestra todos los planes
// juntos sin importar el ticker — mismo patrón que `outboxStore.ts`.

import { promises as fs } from "fs";
import path from "path";
import type { PaperPlan } from "./paperPlan";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "paperplans.json");

export interface StoredPaperPlans {
  updatedAt: string;
  plans: PaperPlan[];
}

const EMPTY: StoredPaperPlans = { updatedAt: "", plans: [] };

export async function loadPaperPlans(): Promise<StoredPaperPlans> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as StoredPaperPlans;
    return Array.isArray(parsed.plans) ? { ...EMPTY, ...parsed } : EMPTY;
  } catch {
    return EMPTY; // aún no hay ningún plan guardado
  }
}

export async function savePaperPlans(plans: PaperPlan[]): Promise<StoredPaperPlans> {
  const payload: StoredPaperPlans = { updatedAt: new Date().toISOString(), plans };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
