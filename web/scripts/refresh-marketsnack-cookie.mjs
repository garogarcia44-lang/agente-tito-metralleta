#!/usr/bin/env node
// Refresca la cookie de sesión de MarketSnack sin intervención manual.
//
// Antes había que copiar la cookie del navegador a mano cada vez que expiraba
// (cada pocos días). Este script inicia sesión en app.marketsnack.com con
// Playwright headless, usando MARKETSNACK_EMAIL/MARKETSNACK_PASSWORD de
// .env.local, y escribe la cookie fresca en data/marketsnack-session.json —
// que lib/marketsnackSession.ts lee en cada request, así que el servidor NO
// necesita reiniciarse para usarla.
//
// Lo lanza launchd cada pocas horas (ver com.tito.marketsnack-refresh.plist,
// mismo patrón que com.tito.watchlist-sync.plist). También se puede correr a
// mano: node scripts/refresh-marketsnack-cookie.mjs
//
// Nunca imprime el email/password/cookie en la salida — solo éxito/fallo y el
// motivo, en data/marketsnack-refresh-log.jsonl.

import { chromium } from "playwright";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
loadEnv({ path: path.join(ROOT, ".env.local") });

const DATA_DIR = path.join(ROOT, "data");
const SESSION_FILE = path.join(DATA_DIR, "marketsnack-session.json");
const LOG_FILE = path.join(DATA_DIR, "marketsnack-refresh-log.jsonl");
const LOGIN_URL = "https://app.marketsnack.com/login";

async function log(event, detail) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), event, detail }) + "\n";
  await fs.appendFile(LOG_FILE, line, "utf8");
}

async function main() {
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
