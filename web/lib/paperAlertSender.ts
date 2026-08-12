// Orquesta una alerta de "Mis Trades" de punta a punta: construir el mensaje
// (`paperAlert.ts`, puro) → revisar si ya se mandó (`alertLogStore.ts`) → mandarla
// (`telegram.ts`) → registrar el intento. Solo servidor, con I/O — por eso no está
// en `paperAlert.ts` (que es puro y sí tiene tests).

import { buildAlertMessage, type AlertContext } from "./paperAlert";
import { appendAlertLog, wasAlertSent } from "./alertLogStore";
import { sendTelegramAlert, type TelegramResult } from "./telegram";

export interface SendPaperAlertResult extends TelegramResult {
  /** true si no se mandó porque YA se había mandado antes (no es un error). */
  duplicate: boolean;
  alertId: string;
}

export async function sendPaperAlertOnce(ctx: AlertContext, now: Date = new Date()): Promise<SendPaperAlertResult> {
  const { id, planId, event, text } = buildAlertMessage(ctx);

  if (await wasAlertSent(id)) {
    return { sent: false, duplicate: true, alertId: id, reason: "Ya se había mandado esta alerta." };
  }

  const result = await sendTelegramAlert(text);
  await appendAlertLog({
    id, planId, event, at: now.toISOString(), sent: result.sent, reason: result.reason,
    sid: result.messageId != null ? String(result.messageId) : undefined,
  });
  return { ...result, duplicate: false, alertId: id };
}
