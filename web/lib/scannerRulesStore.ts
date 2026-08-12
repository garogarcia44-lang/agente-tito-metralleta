// Persistencia de las reglas activas del escaneo automático + el historial de
// propuestas del ciclo de mejora. data/scanner-rules.json (gitignored). Solo
// servidor. La generación de propuestas es pura (lib/ruleProposals.ts); esto
// solo guarda/lee — y crucialmente, `active` SOLO cambia cuando se aprueba una
// propuesta explícitamente (app/api/scanner-rules/route.ts), nunca solo.

import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_SCANNER_RULES, type ScannerRules } from "./scannerRules";
import type { RuleKey } from "./ruleProposals";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "scanner-rules.json");

export interface RuleProposal {
  id: string;
  ruleKey: RuleKey;
  currentValue: number;
  proposedValue: number;
  sampleSize: number;
  actualHitRate: number;
  avgEstimatedProbability: number;
  rationale: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  decidedAt: string | null;
}

export interface ScannerRulesFile {
  active: ScannerRules;
  proposals: RuleProposal[];
  updatedAt: string;
}

const EMPTY: ScannerRulesFile = { active: DEFAULT_SCANNER_RULES, proposals: [], updatedAt: "" };

export async function loadScannerRules(): Promise<ScannerRulesFile> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ScannerRulesFile>;
    return {
      active: { ...DEFAULT_SCANNER_RULES, ...parsed.active },
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
      updatedAt: parsed.updatedAt ?? "",
    };
  } catch {
    return EMPTY; // aún no hay archivo — arranca en los valores por defecto
  }
}

export async function saveScannerRules(file: Omit<ScannerRulesFile, "updatedAt">): Promise<ScannerRulesFile> {
  const payload: ScannerRulesFile = { ...file, updatedAt: new Date().toISOString() };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
