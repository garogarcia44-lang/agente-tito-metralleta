#!/usr/bin/env node
// Mantiene viva la cookie de sesión de MarketSnack sin intervención manual —
// pero REACTIVO, no a ciegas: cada corrida primero prueba si la cookie que ya
// hay todavía sirve (una consulta barata, real, sin login) y SOLO si está
// muerta hace el login completo con Playwright. Antes refrescaba sí o sí cada
// hora, hubiera hecho falta o no — esto es más seguro (menos logins
// automatizados de más, que es justo el patrón que un sistema anti-bot
// notaría) y más rápido para recuperarse (corre cada 5 min en vez de cada
// hora, así que el peor caso de "Tito no puede leer MarketSnack" baja de 60
// min a 5).
//
// Por qué se puede caer la sesión: MarketSnack solo permite UNA sesión activa
// por cuenta — si Jorge entra a MarketSnack en su propio navegador, mata la
// sesión del bot al instante (y viceversa: si este script encuentra la
// sesión muerta y hace login de nuevo, saca a Jorge de la suya si estaba dentro
// en ese momento — es la consecuencia esperada, no un bug).
//
// Solo corre en horario de mercado (ver marketHours.mjs) — fuera de esas
// horas no hace falta mantenerla viva, nada la va a usar.
//
// Este script inicia sesión en app.marketsnack.com con Playwright headless,
// usando MARKETSNACK_EMAIL/MARKETSNACK_PASSWORD de .env.local, y escribe la
// cookie fresca en data/marketsnack-session.json — que lib/marketsnackSession.ts
// lee en cada request, así que el servidor NO necesita reiniciarse para usarla.
//
// Lo lanza launchd (ver com.tito.marketsnack-refresh.plist). También se puede
// correr a mano: node scripts/refresh-marketsnack-cookie.mjs
//
// Nunca imprime el email/password/cookie en la salida — solo éxito/fallo y el
// motivo, en data/marketsnack-refresh-log.jsonl.

import { chromium } from "playwright";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";
import { enMercado } from "./marketHours.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
loadEnv({ path: path.join(ROOT, ".env.local") });

const DATA_DIR = path.join(ROOT, "data");
const SESSION_FILE = path.join(DATA_DIR, "marketsnack-session.json");
const LOG_FILE = path.join(DATA_DIR, "marketsnack-refresh-log.jsonl");
const LOGIN_URL = "https://app.marketsnack.com/login";
// Endpoint liviano solo para probar si la cookie sirve — un solo activo, no
// una cadena de opciones ni el flow feed completo.
const HEALTHCHECK_URL = "https://app.marketsnack.com/api/assets/AAPL";

async function log(event, detail) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), event, detail }) + "\n";
  await fs.appendFile(LOG_FILE, line, "utf8");
}

/** true si la cookie guardada todavía sirve — sin hacer login, un solo GET. */
async function sesionViva(cookieHeader) {
  const res = await fetch(HEALTHCHECK_URL, {
    headers: { Accept: "application/json", Cookie: cookieHeader },
    redirect: "manual",
  }).catch(() => null);
  return !!res && res.status === 200;
}

async function main() {
  const now = new Date();
  if (!enMercado(now)) process.exit(0); // fuera de horario de mercado — nada que mantener vivo

  let current = null;
  try {
    current = JSON.parse(await fs.readFile(SESSION_FILE, "utf8"));
  } catch {
    // sin sesión guardada todavía — sigue directo al login
  }
  if (current?.cookie && (await sesionViva(current.cookie))) {
    await log("ok_sin_cambios", "La sesión seguía viva, no hizo falta relogear.");
    process.exit(0);
  }

  const email = process.env.MARKETSNACK_EMAIL;
  const password = process.env.MARKETSNACK_PASSWORD;
  if (!email || !password) {
    await log("error", "Falta MARKETSNACK_EMAIL o MARKETSNACK_PASSWORD en .env.local.");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button:has-text("Log in")');

    // Éxito = ya no estamos en /login. Fallo = sigue ahí (credenciales o error del sitio).
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 }).catch(() => {});

    if (page.url().includes("/login")) {
      const errorText = await page
        .locator("text=/incorrect|invalid|error/i")
        .first()
        .textContent()
        .catch(() => null);
      await log("error", errorText ?? "Seguía en /login tras enviar el formulario — revisa las credenciales.");
      process.exit(1);
    }

    const cookies = await context.cookies("https://app.marketsnack.com");
    if (cookies.length === 0) {
      await log("error", "Login pareció exitoso pero no se encontraron cookies de marketsnack.com.");
      process.exit(1);
    }

    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      SESSION_FILE,
      JSON.stringify({ cookie: cookieHeader, updatedAt: new Date().toISOString(), source: "auto" }, null, 2),
      "utf8",
    );
    await log("ok", `Cookie refrescada (${cookies.length} cookies).`);
  } finally {
    await browser.close();
  }
}

main().catch(async (err) => {
  await log("error", String(err?.message ?? err).slice(0, 500));
  process.exit(1);
});
