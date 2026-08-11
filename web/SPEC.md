# Spec — Lector web "Tito Metralleta" (v1)

Fecha: 2026-07-22 · Estado: aprobado, en implementación

## Objetivo

Primer incremento de la web interactiva que lee los datos del **Agente Principal (de Opciones)**.
Un input recibe un **ticker**; la app descarga la option chain desde **MarketSnack**, muestra los
**pasos del proceso en vivo** durante la carga, y presenta una **tabla de detalle** con los
cálculos base del agente (Open Premium y Notional Value).

Cubre las Tareas 1, 2 y 5 del [Proceso Principal](../Agente%20Principal/Proceso%20Principal.md).

> **Nota (ago 2026):** este documento describía originalmente la integración con Massive
> (jul 2026). Massive y su reemplazo posterior, Tradier, quedaron completamente retirados —
> MarketSnack (que el usuario ya paga) resultó tener su propia cadena de opciones completa
> (OI, bid/ask, IV, griegos), así que reemplaza a ambos. El flujo, los modelos (`Row`) y las
> fórmulas de abajo no cambiaron; solo el proveedor y los endpoints.

## Stack

- **Next.js** (App Router, TypeScript), en `Agente Tito Metralleta/web/`.
- Credenciales en `.env.local` (server-only, nunca `NEXT_PUBLIC`, en `.gitignore`): `MARKETSNACK_COOKIE`,
  `MARKETSNACK_MAX_EXPIRATIONS`, `FINNHUB_API_KEY`. La excepción a propósito es `NEXT_PUBLIC_LOGO_DEV_TOKEN`
  (token *publishable* de logo.dev, se usa en el navegador).
- Progreso en vivo vía **SSE** (Server-Sent Events) desde un route handler.

## Proveedor de datos: MarketSnack

- Base URL: `https://app.marketsnack.com` · Auth: header `Cookie` con la sesión (`MARKETSNACK_COOKIE`).
- Vencimientos: `GET /api/assets/{TICKER}/expirations`.
- Cadena por vencimiento: `GET /api/assets/{TICKER}/option_chain_extended?expiration_date=X`
  (un request por vencimiento, capado por `MARKETSNACK_MAX_EXPIRATIONS`).
- Campos usados por contrato: `open_interest`, `volume`, `strike`, `expiration`, `type`,
  `shares_per_contract`, `symbol`, `price`.

### Por qué el precio sigue sin usar bid/ask
MarketSnack **sí** trae `last_quote.bid`/`.ask` e IV/griegos reales por contrato — pero
`RawContract` (el tipo que consume `lib/compute.ts`) nunca se conectó a esos campos porque nada
en la tabla los necesitaba (a diferencia del screener de Wheel, que sí usa bid/ask reales). El
precio de la fila sigue siendo el **fallback** de siempre: `last_trade.price ?? day.close ?? day.vwap`.
La UI etiqueta la columna como "Open Premium (px)" y muestra la fuente del precio.

## Flujo de datos

1. Usuario escribe ticker → submit.
2. Frontend abre `EventSource` a `GET /api/chain?ticker=XXX`.
3. Servidor emite eventos `step` / `company` mientras:
   1. `Buscando información de {TICKER}…` → fetch de detalles + snapshot → emite evento `company`
      (logo, nombre, exchange, sector, Stock Price, % cambio, market cap, volumen, rango, cierre previo, empleados, descripción).
   2. `Conectando con MarketSnack…`
   3. `Descargando option chain de {TICKER} — página N…` (avanza con `next_url`)
   4. `Consolidando C contratos en E vencimientos…`
   5. `Calculando Open Premium por strike…`
   6. `Calculando Valor Nocional…`
   7. `Ordenando por Open Interest (mayor → menor)…`
4. Servidor emite `done` con `{ rows, meta }`.
5. Frontend: el panel de empresa (logo + info + stats) se pinta en cuanto llega `company`
   (antes que la tabla); la tabla se pinta con `done`. La tabla incluye una fila TOTAL
   con la sumatoria de Open Interest, Volumen, Open Premium y **Notional Value**.

### Endpoints usados
- Option chain: `GET /api/assets/{TICKER}/expirations` + `option_chain_extended?expiration_date=X` (MarketSnack, uno por vencimiento).
- Info de empresa: `GET /api/assets/{TICKER}` (MarketSnack — nombre, market cap, descripción, precio del día, `earnings_date`).
- Logo: se pide **directo desde el navegador** a `https://img.logo.dev/ticker/{TICKER}?token=NEXT_PUBLIC_LOGO_DEV_TOKEN` (logo.dev, token público) — ya no hay proxy de servidor ni key que proteger.

## Gráfica Top 5 por Notional (TradingView Lightweight Charts)

- Tras `done`, el frontend pide `GET /api/history?ticker=XXX` (barras diarias del subyacente, ~1 año, vía Yahoo Finance)
  y calcula el **top 5 contratos por Notional Value**.
- Se renderiza un candlestick del precio con **TradingView Lightweight Charts** (`lightweight-charts`, open source)
  y una **línea horizontal (price line) por cada uno de los top 5 strikes**, con color y etiqueta
  (`#N · tipo strike · notional`). Debajo, una leyenda con contrato, vencimiento, OI, Open Premium y Notional.
- El logo/gráfica se muestran **antes** de la tabla. Endpoint de barras: `/v8/finance/chart/{ticker}` de Yahoo Finance (no oficial, sin key, requiere `User-Agent` de navegador).

## Componentes

| Archivo | Responsabilidad | Depende de |
|---------|-----------------|------------|
| `lib/types.ts` | Tipos `RawContract`, `Row`, eventos SSE | — |
| `lib/compute.ts` | Funciones **puras**: `contractPrice`, `openPremium`, `notionalValue`, `toRow`, `sortByOpenInterestDesc` | — |
| `lib/marketsnack.ts` | Cliente MarketSnack: cadena + empresa + flujo, descarga por vencimiento con callback de progreso | cookie de sesión, `fetch` |
| `app/api/chain/route.ts` | Orquesta y transmite pasos por SSE | marketsnack, compute |
| `app/page.tsx` | UI: input, lista de pasos en vivo, tabla | — |

## Modelo `Row`

```
{
  ticker, contractType ('call'|'put'), expiration, strike,
  openInterest, volume, price (contractPrice), priceSource,
  openPremium (OI × price), notionalValue (OI × 100 × strike)
}
```

## Tabla de resultados

Columnas: `Vencimiento · Tipo · Strike · Open Interest · Volumen · Precio · Open Premium · Notional Value`.
Orden por Open Interest de mayor a menor. Encabezados ordenables.

## Fórmulas

```
price          = last_trade.price ?? day.close ?? day.vwap
openPremium    = openInterest × price
notionalValue  = openInterest × 100 × strike
```

## Errores

- Ticker vacío/inválido o sin datos → evento `error` + mensaje en UI.
- 401/403 (auth) → "Revisa el access token"/cookie de sesión.
- Sesión de MarketSnack expirada → mensaje pidiendo renovar `MARKETSNACK_COOKIE`.
- Contrato sin precio → `openPremium = null`, se muestra `n/a`.
- Tope de seguridad: `MARKETSNACK_MAX_EXPIRATIONS` (default 20); si se alcanza antes de agotar los vencimientos, la meta marca `truncated`.

## Pruebas

- Unit (vitest) sobre `lib/compute.ts` (funciones puras): cálculos, fallbacks de precio, orden.

## Fuera de alcance (incrementos siguientes)

Tarea 3 (comparación sectorial), Tarea 4 (interpretación muros Buy/Sell), Tarea 6 (liquidez vs "7 Magníficas"),
Tarea 7 (noticias RSS), histórico de 5 días, filtros por vencimiento/strike, greeks/GEX.
