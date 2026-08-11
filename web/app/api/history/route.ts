// GET /api/history?ticker=XXX — barras diarias del subyacente para la gráfica.

import { fetchDailyBars } from "@/lib/yahooFinance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!ticker) {
    return Response.json({ error: "ticker requerido" }, { status: 400 });
  }
  try {
    const bars = await fetchDailyBars(ticker);
    return Response.json({ ticker, bars });
  } catch {
    return Response.json({ error: "Error al cargar histórico." }, { status: 502 });
  }
}
