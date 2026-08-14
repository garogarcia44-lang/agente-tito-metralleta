// Planes condicionales de PAPER TRADING ("Mis Trades" — Fase A).
//
// Todo lo que vive aquí es SIMULACIÓN: no coloca órdenes, no toca ningún broker, no
// mueve dinero real. Fase A crea los planes a mano (sin detección automática todavía —
// eso llega en una fase futura y aprobada aparte), pero la máquina de estados, el
// cálculo de P&L y el stop dinámico son los mismos que usará la detección automática
// cuando exista.
//
// El stop dinámico NO calcula un porcentaje de trailing por su cuenta — eso sería fijar
// un umbral arbitrario sin aprobación (pedido explícito del usuario). `raiseDynamicStop`
// solo aplica y valida un valor que decide quien lo llama (hoy, el usuario desde la UI).
//
// Funciones puras, sin I/O. La persistencia vive en `paperPlansStore.ts`.

import type { ContractType } from "./types";
import type { NewsItem } from "./news";

export type PlanStatus = "pendiente" | "activa" | "ganada" | "perdida" | "expirada";
export type Horizon = "intradia" | "swing";
export type PlanOrigin = "manual" | "auto";

export interface StatusChange {
  status: PlanStatus;
  at: string; // ISO
  reason: string;
}

export interface StopChange {
  value: number;
  at: string; // ISO
  reason: string;
}

export interface PaperPlan {
  id: string;
  ticker: string;
  contractType: ContractType;
  strike: number;
  expiration: string; // YYYY-MM-DD
  /** Identificador del contrato (símbolo OCC). */
  symbol: string;
  /** Libre por ahora (ej. "long_call") — sin estrategias multi-pata en Fase A. */
  strategy: string;
  horizon: Horizon;
  trigger: number;
  target: number;
  initialStop: number;
  dynamicStop: number;
  /** 0-100. null si no se estimó. */
  estimatedProbability: number | null;
  /** Editable por el usuario incluso después de creado. */
  contracts: number;
  entryPrice: number | null;
  enteredAt: string | null;
  exitPrice: number | null;
  exitedAt: string | null;
  /** Mayor precio (prima) alcanzado desde la entrada. */
  highestPrice: number | null;
  quoteSource: string | null;
  quoteAt: string | null;
  status: PlanStatus;
  statusHistory: StatusChange[];
  stopHistory: StopChange[];
  origin: PlanOrigin;
  /** Versión del modelo/reglas que generó la señal. null en planes manuales. */
  rulesVersion: string | null;
  createdAt: string;
  notes: string | null;
  /**
   * Diario de noticias reales (Finnhub, `lib/news.ts`) — foto tomada en el momento
   * de cada transición, no reconstruida después (`fetchTickerNews` solo trae los
   * últimos 14 días desde "ahora", no un rango histórico arbitrario). null hasta que
   * ocurre la transición correspondiente, o si la captura falló (best-effort).
   */
  newsAtEntry: NewsItem[] | null;
  newsAtExit: NewsItem[] | null;
}

export interface CreatePlanInput {
  id: string;
  ticker: string;
  contractType: ContractType;
  strike: number;
  expiration: string;
  symbol: string;
  strategy: string;
  horizon: Horizon;
  trigger: number;
  target: number;
  initialStop: number;
  estimatedProbability?: number | null;
  contracts: number;
  origin?: PlanOrigin;
  rulesVersion?: string | null;
  notes?: string | null;
}

/** Crea un plan en estado `pendiente`. El stop dinámico arranca igual al inicial. */
export function createPaperPlan(input: CreatePlanInput, now: Date): PaperPlan {
  const nowIso = now.toISOString();
  return {
    id: input.id,
    ticker: input.ticker.trim().toUpperCase(),
    contractType: input.contractType,
    strike: input.strike,
    expiration: input.expiration,
    symbol: input.symbol,
    strategy: input.strategy,
    horizon: input.horizon,
    trigger: input.trigger,
    target: input.target,
    initialStop: input.initialStop,
    dynamicStop: input.initialStop,
    estimatedProbability: input.estimatedProbability ?? null,
    contracts: input.contracts,
    entryPrice: null,
    enteredAt: null,
    exitPrice: null,
    exitedAt: null,
    highestPrice: null,
    quoteSource: null,
    quoteAt: null,
    status: "pendiente",
    statusHistory: [{ status: "pendiente", at: nowIso, reason: "Plan creado." }],
    stopHistory: [{ value: input.initialStop, at: nowIso, reason: "Stop inicial." }],
    origin: input.origin ?? "manual",
    rulesVersion: input.rulesVersion ?? null,
    createdAt: nowIso,
    notes: input.notes ?? null,
    newsAtEntry: null,
    newsAtExit: null,
  };
}

const ALLOWED_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  pendiente: ["activa", "expirada"],
  activa: ["ganada", "perdida", "expirada"],
  ganada: [],
  perdida: [],
  expirada: [],
};

export class InvalidPlanTransitionError extends Error {
  constructor(from: PlanStatus, to: PlanStatus) {
    super(`No se puede pasar de "${from}" a "${to}".`);
    this.name = "InvalidPlanTransitionError";
  }
}

export function canTransition(from: PlanStatus, to: PlanStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

function pushStatus(plan: PaperPlan, status: PlanStatus, at: string, reason: string): PaperPlan {
  if (!canTransition(plan.status, status)) {
    throw new InvalidPlanTransitionError(plan.status, status);
  }
  return {
    ...plan,
    status,
    statusHistory: [...plan.statusHistory, { status, at, reason }],
  };
}

export interface Quote {
  price: number;
  source: string;
  at: string; // ISO
}

/** `pendiente` → `activa`. Registra precio/hora de entrada y arranca `highestPrice`. */
export function activatePlan(plan: PaperPlan, entry: Quote, now: Date, reason = "Gatillo cruzado."): PaperPlan {
  const withStatus = pushStatus(plan, "activa", now.toISOString(), reason);
  return {
    ...withStatus,
    entryPrice: entry.price,
    enteredAt: entry.at,
    highestPrice: entry.price,
    quoteSource: entry.source,
    quoteAt: entry.at,
  };
}

/**
 * Actualiza el mayor precio alcanzado si `observed` lo supera. Solo tiene efecto con
 * el plan `activa`; con cotizaciones inválidas o atrasadas respecto a la última vista,
 * no actualiza nada (por eso pide `quoteAt` y lo compara).
 */
export function updateHighestPrice(plan: PaperPlan, observed: Quote): PaperPlan {
  if (plan.status !== "activa") return plan;
  if (plan.quoteAt && observed.at < plan.quoteAt) return plan; // dato atrasado, se ignora
  const highest =
    plan.highestPrice == null ? observed.price : Math.max(plan.highestPrice, observed.price);
  return { ...plan, highestPrice: highest, quoteSource: observed.source, quoteAt: observed.at };
}

export interface StopRaiseResult {
  plan: PaperPlan;
  /** false si `value` no superaba el stop dinámico actual — nunca se reduce. */
  applied: boolean;
}

/**
 * Sube el stop dinámico a `value`. NO calcula el valor — eso lo decide quien llama
 * (hoy, el usuario desde la UI; en una fase futura, reglas aprobadas). Rechaza el
 * cambio si `value` no es mayor al stop actual, y conserva el historial completo.
 */
export function raiseDynamicStop(
  plan: PaperPlan,
  value: number,
  reason: string,
  now: Date,
): StopRaiseResult {
  if (plan.status !== "activa" || value <= plan.dynamicStop) {
    return { plan, applied: false };
  }
  return {
    plan: {
      ...plan,
      dynamicStop: value,
      stopHistory: [...plan.stopHistory, { value, at: now.toISOString(), reason }],
    },
    applied: true,
  };
}

export function computePnl(entryPrice: number, exitPrice: number, contracts: number): number {
  return (exitPrice - entryPrice) * 100 * contracts;
}

/** `activa` → `ganada` | `perdida`. */
export function closePlan(
  plan: PaperPlan,
  outcome: "ganada" | "perdida",
  exit: { price: number; at: string },
  reason: string,
  now: Date,
): PaperPlan {
  const withStatus = pushStatus(plan, outcome, now.toISOString(), reason);
  return { ...withStatus, exitPrice: exit.price, exitedAt: exit.at };
}

/** `pendiente` | `activa` → `expirada`. Sin precio de salida: no hubo cierre real. */
export function expirePlan(plan: PaperPlan, reason: string, now: Date): PaperPlan {
  return pushStatus(plan, "expirada", now.toISOString(), reason);
}

/** P&L del plan si ya cerró con precio de salida; `null` si sigue abierto o expiró sin precio. */
export function planPnl(plan: PaperPlan): number | null {
  if (plan.entryPrice == null || plan.exitPrice == null) return null;
  return computePnl(plan.entryPrice, plan.exitPrice, plan.contracts);
}
