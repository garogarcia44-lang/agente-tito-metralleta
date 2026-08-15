// Horario REAL de mercado (NYSE) — no solo "lunes a viernes 9:30-16:00 ET",
// también los días festivos del mercado, aunque caigan entre semana (Acción
// de Gracias, Navidad, etc). Antes cada script (scan-auto.mjs,
// monitor-auto.mjs) tenía su propia copia de enMercado() que solo miraba
// fin de semana + hora, sin festivos — un jueves de Acción de Gracias los
// procesos automáticos habrían intentado trabajar igual, sin que MarketSnack
// tuviera nada nuevo que dar. Ahora un solo enMercado() compartido, con
// festivos calculados de verdad.
//
// Los festivos se CALCULAN, no son una lista fija que haya que actualizar
// cada año: fecha fija con regla de "observado" si cae fin de semana (Año
// Nuevo, Juneteenth, 4 de julio, Navidad), "enésimo lunes/jueves del mes"
// (MLK, Presidentes, Memorial Day, Labor Day, Acción de Gracias), y Good
// Friday vía el algoritmo estándar de Gauss para la fecha de Pascua.
//
// Límite conocido, a propósito no cubierto: los CIERRES ANTICIPADOS (ej.
// 1PM ET la víspera de Acción de Gracias) no cierran el mercado del todo,
// solo lo acortan — no se inventa el horario exacto de cada cierre corto,
// así que esas tardes los procesos automáticos seguirán intentando trabajar
// un poco más de lo necesario. Costo: unas pocas llamadas de más, unos
// pocos días al año — no vale la complejidad de cubrirlo.

function nthWeekdayOfMonth(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return new Date(Date.UTC(year, month, day));
}

function lastWeekdayOfMonth(year, month, weekday) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const lastWeekday = last.getUTCDay();
  const offset = (lastWeekday - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, last.getUTCDate() - offset));
}

/** Algoritmo estándar (Meeus/Jones/Butcher) para el domingo de Pascua. */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=marzo, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Sábado se observa el viernes anterior; domingo, el lunes siguiente. */
function observedDate(date) {
  const dow = date.getUTCDay();
  if (dow === 6) return new Date(date.getTime() - 86_400_000);
  if (dow === 0) return new Date(date.getTime() + 86_400_000);
  return date;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function marketHolidays(year) {
  return new Set([
    ymd(observedDate(new Date(Date.UTC(year, 0, 1)))),                       // Año Nuevo
    ymd(nthWeekdayOfMonth(year, 0, 1, 3)),                                    // MLK
    ymd(nthWeekdayOfMonth(year, 1, 1, 3)),                                    // Presidentes
    ymd(new Date(easterSunday(year).getTime() - 2 * 86_400_000)),            // Good Friday
    ymd(lastWeekdayOfMonth(year, 4, 1)),                                      // Memorial Day
    ymd(observedDate(new Date(Date.UTC(year, 5, 19)))),                       // Juneteenth
    ymd(observedDate(new Date(Date.UTC(year, 6, 4)))),                        // 4 de julio
    ymd(nthWeekdayOfMonth(year, 8, 1, 1)),                                    // Labor Day
    ymd(nthWeekdayOfMonth(year, 10, 4, 4)),                                   // Acción de Gracias
    ymd(observedDate(new Date(Date.UTC(year, 11, 25)))),                      // Navidad
  ]);
}

export function isMarketHoliday(now) {
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const year = Number(dateStr.slice(0, 4));
  return marketHolidays(year).has(dateStr);
}

/** Lunes a viernes, 9:30 AM–4:00 PM ET, y que no sea festivo del mercado. */
export function enMercado(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const dow = get("weekday");
  const hm = Number(get("hour")) * 100 + Number(get("minute"));
  const esFinde = dow === "Sat" || dow === "Sun";
  if (esFinde) return false;
  if (hm < 930 || hm > 1600) return false;
  return !isMarketHoliday(now);
}
