// Cliente de Telegram Bot API. Solo servidor. Reemplaza a Twilio/WhatsApp — Twilio
// exige cuenta de pago para plantillas de contenido incluso en su propio sandbox
// nuevo (verificado en vivo: error 20003, "Content API no disponible en Trial").
// Telegram es gratis sin límite y sin necesitar plantillas aprobadas.
//
// Sin TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID configurados, `sendTelegramAlert` no
// manda nada y devuelve `sent:false` con el motivo — no lanza, para no tronar la
// acción del plan que la disparó.

const API_BASE = "https://api.telegram.org";

export interface TelegramResult {
  sent: boolean;
  reason?: string;
  /** id del mensaje en Telegram, si se mandó. */
  messageId?: number;
}

function config(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}

export async function sendTelegramAlert(text: string): Promise<TelegramResult> {
  const cfg = config();
  if (!cfg) {
    return { sent: false, reason: "Falta configurar TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID en .env.local." };
  }

  const res = await fetch(`${API_BASE}/bot${cfg.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: cfg.chatId, text }),
  }).catch(() => null);

  if (!res) return { sent: false, reason: "No se pudo contactar a Telegram." };
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; result?: { message_id?: number }; description?: string }
    | null;

  if (!res.ok || !json?.ok) {
    return { sent: false, reason: `Telegram respondió ${res.status}. ${json?.description ?? ""}`.trim() };
  }
  return { sent: true, messageId: json.result?.message_id };
}

/**
 * Busca el chat_id de la última conversación que le escribió al bot — solo para
 * configuración inicial (correrlo una vez a mano), no lo usa la app en producción.
 */
export async function findLatestChatId(token: string): Promise<{ chatId: string; from: string } | null> {
  const res = await fetch(`${API_BASE}/bot${token}/getUpdates`).catch(() => null);
  if (!res || !res.ok) return null;
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; result?: { message?: { chat?: { id?: number }; from?: { first_name?: string } } }[] }
    | null;
  const updates = json?.result ?? [];
  const last = updates[updates.length - 1];
  const chatId = last?.message?.chat?.id;
  if (chatId == null) return null;
  return { chatId: String(chatId), from: last?.message?.from?.first_name ?? "?" };
}
