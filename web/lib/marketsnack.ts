// Cliente del API interno de MarketSnack (app.marketsnack.com). Solo servidor.
// Auth por cookie de sesión (lib/marketsnackSession.ts: data/marketsnack-session.json
// refrescada sola por scripts/refresh-marketsnack-cookie.mjs, con MARKETSNACK_COOKIE
// en .env.local como respaldo manual). Ver SCOREDCARD/Scoredcard.md.
//
// Además del flujo (Time & Sales), MarketSnack expone su propia cadena de
// opciones completa por vencimiento (`/api/assets/{TICKER}/option_chain_extended`),
// con OI, bid/ask e IV/griegos reales — así que también hace de fuente de la
// cadena y de la info de empresa (antes cubierto por Massive/Tradier). Las
// velas del subyacente NO están aquí (ver lib/yahooFinance.ts).

import type { CompanyInfo, RawContract } from "./types";
import type { RawTrade } from "./flow";
import { marketDateStr } from "./occ";
import { loadMarketsnackCookie } from "./marketsnackSession";

const BASE_URL = "https://app.marketsnack.com";

export class MarketSnackError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "MarketSnackError";
    this.status = status;
  }
}

async function cookie(): Promise<string> {
  const c = await loadMarketsnackCookie();
  if (!c) {
    throw new MarketSnackError(
      "Falta la cookie de MarketSnack. Corre scripts/refresh-marketsnack-cookie.mjs o pega MARKETSNACK_COOKIE en .env.local.",
    );
  }
  return c;
}

export interface FetchFlowOptions {
  period?: string; // "1d" | "5d" | "1m"
  maxPages?: number;
  minPremium?: number; // filtro server-side: solo trades con premium ≥ este valor ($)
  targetDays?: number; // detener la paginación al cubrir N días hacia atrás
  onPage?: (page: number, accumulated: number) => void | Promise<void>;
}

export interface FlowResult {
  trades: RawTrade[];
  pages: number;
  truncated: boolean;
}

/**
 * Descarga el flujo (Time & Sales) de un ticker desde MarketSnack, paginando por
 * `next_page_token`. Endpoint: /api/flow_feed?filter[scope]=all&filter[symbol][]=TICKER&period=…
 */
export async function fetchFlow(
  ticker: string,
  opts: FetchFlowOptions = {},
): Promise<FlowResult> {
  const clean = ticker.trim().toUpperCase();
  if (!clean) throw new MarketSnackError("Ticker vacío.");
  return paginate(clean, opts);
}

/**
 * Igual que `fetchFlow` pero SIN filtro de símbolo: devuelve el flujo de todo el
 * mercado. Es lo que alimenta el screener de /ideas — el piso de premium
 * (`minPremium`) filtra server-side, así que el payload se mantiene chico.
 */
export async function fetchMarketFlow(opts: FetchFlowOptions = {}): Promise<FlowResult> {
  return paginate(null, opts);
}

/** Cuerpo de paginación compartido. `symbol === null` → escaneo de todo el mercado. */
async function paginate(
  symbol: string | null,
  opts: FetchFlowOptions = {},
): Promise<FlowResult> {
  const clean = symbol;
  const period = opts.period ?? "5d";
  const maxPages = opts.maxPages ?? 10;
  const cookieHeader = await cookie();

  const trades: RawTrade[] = [];
  let token: string | null = null;
  let page = 0;
  let truncated = false;
  // La paginación del feed camina hacia atrás en el tiempo; con targetDays paramos
  // al cubrir la ventana pedida.
  const cutoffMs = opts.targetDays ? Date.now() - opts.targetDays * 86_400_000 : null;

  do {
    page += 1;
    const params = new URLSearchParams();
    params.set("filter[scope]", "all");
    if (clean) params.append("filter[symbol][]", clean);
    params.set("period", period);
    if (opts.minPremium && opts.minPremium > 0) {
      params.set("filter[premium][gte]", String(Math.floor(opts.minPremium)));
    }
    if (token) params.set("next_page_token", token);
    const url = `${BASE_URL}/api/flow_feed?${params.toString()}`;

    const res = await fetch(url, {
      headers: { Accept: "application/json", Cookie: cookieHeader },
      cache: "no-store",
      redirect: "manual",
    });

    // Sesión inválida/expirada → MarketSnack redirige a /login o responde 401.
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      throw new MarketSnackError(
        "Sesión de MarketSnack inválida o expirada. Se refresca sola en el próximo pase de scripts/refresh-marketsnack-cookie.mjs, o corre el script a mano.",
        res.status,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new MarketSnackError(
        `MarketSnack respondió ${res.status}. ${body.slice(0, 200)}`.trim(),
        res.status,
      );
    }

    const json: { list?: RawTrade[]; meta?: { next_page_token?: string } } =
      await res.json();
    const list = json.list ?? [];
    trades.push(...list);
    await opts.onPage?.(page, trades.length);

    token = json.meta?.next_page_token ?? null;
    if (list.length === 0) break;
    if (cutoffMs != null) {
      const oldest = list[list.length - 1]?.timestamp;
      if (oldest && Date.parse(oldest) < cutoffMs) break; // ventana cubierta
    }
    if (page >= maxPages) {
      truncated = Boolean(token);
      break;
    }
  } while (token);

  return { trades, pages: page, truncated };
}

// ---------- cadena de opciones + info de empresa ----------

/** Tope de vencimientos consultados por ticker (cada uno es 1 request). */
function maxExpirations(): number {
  const n = Number(process.env.MARKETSNACK_MAX_EXPIRATIONS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}

// Cortesía con el servidor de MarketSnack: aunque es la cuenta propia del
// usuario, un escaneo de 41 tickers (Wheel) puede disparar muchas llamadas en
// paralelo. Se deja un margen conservador y se comparte entre todas las
// llamadas de esta sección.
const RATE_LIMIT_PER_MIN = 120;
const MIN_GAP_MS = 60_000 / RATE_LIMIT_PER_MIN;
let nextSlot = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_GAP_MS;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function getJson<T>(path: string): Promise<T | null> {
  const cookieHeader = await cookie();
  await throttle();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json", Cookie: cookieHeader },
    cache: "no-store",
    redirect: "manual",
  });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    throw new MarketSnackError(
      "Sesión de MarketSnack inválida o expirada. Se refresca sola en el próximo pase de scripts/refresh-marketsnack-cookie.mjs, o corre el script a mano.",
      res.status,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new MarketSnackError(`MarketSnack respondió ${res.status}. ${body.slice(0, 200)}`.trim(), res.status);
  }
  return (await res.json()) as T;
}

interface AssetInfo {
  name?: string;
  description?: string;
  market_cap?: number;
  latest_price?: number;
  regular_price?: number;
  regular_price_change?: { absolute?: number; percentage?: number };
  open_price?: number;
  high?: number;
  low?: number;
  prev_close_price?: number;
  volume?: number;
}

async function fetchAssetInfo(ticker: string): Promise<AssetInfo | null> {
  return getJson<AssetInfo>(`/api/assets/${encodeURIComponent(ticker)}`);
}

/** Info de empresa + stats de precio, vía el endpoint de asset de MarketSnack. */
export async function fetchCompany(ticker: string): Promise<CompanyInfo> {
  const clean = ticker.trim().toUpperCase();
  const a = (await fetchAssetInfo(clean).catch(() => null)) ?? {};

  return {
    ticker: clean,
    name: a.name ?? null,
    exchange: null,
    marketCap: a.market_cap ?? null,
    homepageUrl: null,
    employees: null,
    listDate: null,
    sector: null,
    description: a.description ?? null,
    // El logo se pide directo a logo.dev desde el navegador (CompanyHeader.tsx).
    hasLogo: true,
    price: a.regular_price ?? a.latest_price ?? null,
    change: a.regular_price_change?.absolute ?? null,
    changePercent: a.regular_price_change?.percentage ?? null,
    dayOpen: a.open_price ?? null,
    dayHigh: a.high ?? null,
    dayLow: a.low ?? null,
    dayVolume: a.volume ?? null,
    prevClose: a.prev_close_price ?? null,
  };
}

async function fetchExpirations(ticker: string): Promise<string[]> {
  const json = await getJson<{ date?: string }[]>(`/api/assets/${encodeURIComponent(ticker)}/expirations`);
  return (json ?? []).map((e) => e.date).filter((d): d is string => Boolean(d));
}

interface MsOption {
  symbol?: string;
  strike?: number;
  expiration?: string;
  type?: string;
  shares_per_contract?: number;
  price?: number | null;
  volume?: number;
  open_interest?: number;
  last_quote?: { bid?: number; ask?: number; mid?: number };
}

async function fetchOptionChainExtended(ticker: string, expirationDate: string): Promise<MsOption[]> {
  const json = await getJson<MsOption[]>(
    `/api/assets/${encodeURIComponent(ticker)}/option_chain_extended?expiration_date=${expirationDate}`,
  );
  return json ?? [];
}

function toRawContract(o: MsOption): RawContract {
  return {
    day: { volume: o.volume },
    details: {
      contract_type: o.type,
      expiration_date: o.expiration,
      strike_price: o.strike,
      shares_per_contract: o.shares_per_contract ?? 100,
      ticker: o.symbol,
    },
    last_trade: { price: o.price ?? undefined },
    open_interest: o.open_interest,
  };
}

/**
 * Los contratos de UN SOLO vencimiento exacto — sin pasar por la lista de los
 * primeros MARKETSNACK_MAX_EXPIRATIONS que usa `fetchOptionChain`. Existe para
 * el monitoreo de planes paper (`app/api/monitor`): un plan swing puede tener
 * un vencimiento a más de un año (LEAPS), muy por fuera de esa ventana — pedir
 * la cadena completa nunca lo alcanzaría. Aquí se pide directo el vencimiento
 * exacto que ya trae guardado el plan (`plan.expiration`), un solo request.
 */
export async function fetchContractsForExpiration(
  ticker: string,
  expirationDate: string,
): Promise<RawContract[]> {
  const clean = ticker.trim().toUpperCase();
  if (!clean) throw new MarketSnackError("Ticker vacío.");
  const options = await fetchOptionChainExtended(clean, expirationDate);
  return options.map(toRawContract);
}

export interface FetchProgress {
  /** Se llama al terminar cada vencimiento, con el índice y el total acumulado. */
  onPage?: (page: number, accumulated: number) => void | Promise<void>;
}

export interface ChainResult {
  contracts: RawContract[];
  underlyingPrice: number | null;
  pages: number;
  truncated: boolean;
}

/**
 * Descarga la option chain completa de un ticker: lista los vencimientos y
 * pide cada uno por separado a MarketSnack. Corta en MARKETSNACK_MAX_EXPIRATIONS
 * como salvaguarda.
 */
export async function fetchOptionChain(
  ticker: string,
  progress: FetchProgress = {},
): Promise<ChainResult> {
  const clean = ticker.trim().toUpperCase();
  if (!clean) throw new MarketSnackError("Ticker vacío.");
  const limit = maxExpirations();

  const [asset, allExpirations] = await Promise.all([
    fetchAssetInfo(clean).catch(() => null),
    fetchExpirations(clean),
  ]);
  const underlyingPrice = asset?.regular_price ?? asset?.latest_price ?? null;

  const dates = allExpirations.slice(0, limit);
  const truncated = allExpirations.length > dates.length;

  const contracts: RawContract[] = [];
  let page = 0;
  for (const exp of dates) {
    page += 1;
    const options = await fetchOptionChainExtended(clean, exp);
    for (const o of options) contracts.push(toRawContract(o));
    await progress.onPage?.(page, contracts.length);
  }

  return { contracts, underlyingPrice, pages: page, truncated };
}

// ---------- cadena de PUTS filtrada para el screener de Wheel ----------

export interface WheelChainResult {
  spot: number | null;
  quotes: WheelChainQuote[];
}

export interface WheelChainQuote {
  strike: number;
  expiration: string;
  dte: number;
  bid: number | null;
  ask: number | null;
  lastTrade: number | null;
  openInterest: number;
}

export async function fetchWheelChain(
  ticker: string,
  opts: { dteMin: number; dteMax: number; now?: Date },
): Promise<WheelChainResult> {
  const clean = ticker.trim().toUpperCase();
  if (!clean) throw new MarketSnackError("Ticker vacío.");
  const now = opts.now ?? new Date();
  const day = 24 * 60 * 60 * 1000;
  // Ancla "hoy" en el día de mercado ET (no UTC): ver el aviso en marketDateStr, lib/occ.ts.
  const todayETMs = Date.parse(`${marketDateStr(now)}T00:00:00Z`);

  const [asset, allExpirations] = await Promise.all([
    fetchAssetInfo(clean).catch(() => null),
    fetchExpirations(clean),
  ]);
  const spot = asset?.regular_price ?? asset?.latest_price ?? null;

  const inRange = allExpirations.filter((exp) => {
    const dte = Math.round((Date.parse(`${exp}T00:00:00Z`) - todayETMs) / day);
    return dte >= opts.dteMin && dte <= opts.dteMax;
  });

  const quotes: WheelChainQuote[] = [];
  for (const exp of inRange) {
    const options = await fetchOptionChainExtended(clean, exp);
    const dte = Math.round((Date.parse(`${exp}T00:00:00Z`) - todayETMs) / day);
    for (const o of options) {
      if (o.type !== "put") continue;
      const strike = o.strike;
      if (!(strike != null && strike > 0)) continue;
      quotes.push({
        strike,
        expiration: exp,
        dte,
        bid: o.last_quote?.bid ?? null,
        ask: o.last_quote?.ask ?? null,
        lastTrade: o.price ?? null,
        openInterest: o.open_interest ?? 0,
      });
    }
  }

  // Solo puts OTM: los ITM no son cash-secured puts de Wheel, son otra cosa.
  const otm = spot != null ? quotes.filter((q) => q.strike <= spot) : quotes;
  return { spot, quotes: otm };
}
