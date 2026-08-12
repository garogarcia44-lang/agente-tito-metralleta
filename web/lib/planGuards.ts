// Guardas de un plan AUTO antes de crearlo (Fase C). Puro: recibe los planes ya
// cargados del store y decide si el candidato nuevo se puede crear.
//
// Dos reglas, ambas pedidas explícitamente por el usuario:
//   1. Una sola dirección vigente por ticker — no abrir un put mientras ya hay un
//      call abierto (o viceversa) en el mismo subyacente.
//   2. No duplicar el mismo contrato exacto (mismo símbolo OCC) si ya hay un plan
//      pendiente o activo sobre él.
// "Vigente" = estado pendiente o activa (ganada/perdida/expirada ya no cuentan).

import type { ContractType } from "./types";
import type { PaperPlan, PlanStatus } from "./paperPlan";

const OPEN_STATUSES: PlanStatus[] = ["pendiente", "activa"];

function isOpen(plan: PaperPlan): boolean {
  return OPEN_STATUSES.includes(plan.status);
}

function directionOf(contractType: ContractType): "up" | "down" {
  return contractType === "call" ? "up" : "down";
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
  conflictingPlan?: PaperPlan;
}

/** ¿Ya hay un plan vigente sobre este contrato exacto? */
export function checkDuplicate(existing: PaperPlan[], symbol: string): GuardResult {
  const dup = existing.find((p) => isOpen(p) && p.symbol === symbol);
  if (!dup) return { ok: true };
  return {
    ok: false,
    reason: `Ya hay un plan ${dup.status} sobre este contrato exacto (${symbol}).`,
    conflictingPlan: dup,
  };
}

/** ¿Ya hay un plan vigente de dirección contraria en el mismo ticker? */
export function checkContradiction(
  existing: PaperPlan[],
  ticker: string,
  contractType: ContractType,
): GuardResult {
  const dir = directionOf(contractType);
  const clean = ticker.trim().toUpperCase();
  const opposite = existing.find(
    (p) => isOpen(p) && p.ticker === clean && directionOf(p.contractType) !== dir,
  );
  if (!opposite) return { ok: true };
  return {
    ok: false,
    reason: `Ya hay un plan ${opposite.status} de dirección contraria en ${clean} (${opposite.symbol}). Una sola dirección vigente por ticker.`,
    conflictingPlan: opposite,
  };
}

export interface AutoPlanCandidate {
  ticker: string;
  symbol: string;
  contractType: ContractType;
}

/** Corre ambas guardas. Se detiene en la primera que falle. */
export function checkAutoPlanGuards(existing: PaperPlan[], candidate: AutoPlanCandidate): GuardResult {
  const dup = checkDuplicate(existing, candidate.symbol);
  if (!dup.ok) return dup;
  return checkContradiction(existing, candidate.ticker, candidate.contractType);
}
