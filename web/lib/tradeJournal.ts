// Orquesta la captura del "diario de noticias" de un plan: llama a `fetchTickerNews`
// (`lib/news.ts`, real, Finnhub) en el momento exacto de una transición relevante.
//
// Por qué en el momento y no después: `fetchTickerNews` siempre pide los últimos 14
// días desde "ahora" (no acepta un rango histórico arbitrario — ver lib/news.ts). Si
// se intentara reconstruir "qué noticia explicó este trade" días o semanas después de
// cerrado, la ventana de 14 días ya no cubriría la fecha real de entrada/salida. La
// única forma honesta de correlacionar noticia↔trade es guardar la foto ahora mismo.
//
// Best-effort a propósito: si Finnhub falla o no hay API key, `fetchTickerNews` ya
// devuelve `[]` por su cuenta; esto solo blinda contra un `fetch` que lance una
// excepción de red, para que la transición del plan (activar/cerrar/expirar) NUNCA
// se caiga por un problema de noticias — mismo principio que `paperAlertSender.ts`.

import { fetchTickerNews, type NewsItem } from "./news";

const JOURNAL_NEWS_LIMIT = 8;

export async function captureNewsSnapshot(ticker: string): Promise<NewsItem[] | null> {
  try {
    const items = await fetchTickerNews(ticker, JOURNAL_NEWS_LIMIT);
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}
