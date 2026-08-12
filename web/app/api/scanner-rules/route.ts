// /api/scanner-rules — ciclo de mejora controlada del escaneo automático.
//
//   GET                        → { active, proposals }
//   POST { action:"generate" } → analiza los planes AUTO resueltos y agrega
//                                 propuestas nuevas (lib/ruleProposals.ts) al
//                                 historial. NO cambia `active`.
//   POST { action:"approve", id } → la ÚNICA forma de que un umbral cambie:
//                                 aplica proposedValue a `active` y marca la
//                                 propuesta como aprobada.
//   POST { action:"reject", id }  → descarta la propuesta, `active` no se toca.
//
// Nada de esto se aplica solo. Generar propuestas es analizar, no decidir; solo
// "approve" — una acción humana explícita desde /trades — cambia el umbral que
// usan de verdad /api/scan/intraday y /api/scan/swing.

import { randomUUID } from "crypto";
import { loadPaperPlans } from "@/lib/paperPlansStore";
import { proposeRuleChanges } from "@/lib/ruleProposals";
import { loadScannerRules, saveScannerRules, type RuleProposal } from "@/lib/scannerRulesStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { active, proposals } = await loadScannerRules();
  return Response.json({ active, proposals });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const file = await loadScannerRules();
  const now = new Date().toISOString();

  if (body.action === "generate") {
    const { plans } = await loadPaperPlans();
    const drafts = proposeRuleChanges(plans, file.active);

    const pendingKeys = new Set(
      file.proposals.filter((p) => p.status === "pending").map((p) => p.ruleKey),
    );
    const fresh: RuleProposal[] = drafts
      .filter((d) => !pendingKeys.has(d.ruleKey)) // no duplicar si ya hay una pendiente para ese umbral
      .map((d) => ({
        id: randomUUID(),
        ruleKey: d.ruleKey,
        currentValue: d.currentValue,
        proposedValue: d.proposedValue,
        sampleSize: d.sampleSize,
        actualHitRate: d.actualHitRate,
        avgEstimatedProbability: d.avgEstimatedProbability,
        rationale: d.rationale,
        createdAt: now,
        status: "pending" as const,
        decidedAt: null,
      }));

    const saved = await saveScannerRules({ active: file.active, proposals: [...file.proposals, ...fresh] });
    return Response.json({ active: saved.active, proposals: saved.proposals, created: fresh.length });
  }

  if (body.action === "approve" || body.action === "reject") {
    if (typeof body.id !== "string") {
      return Response.json({ error: "Falta id." }, { status: 400 });
    }
    const proposal = file.proposals.find((p) => p.id === body.id);
    if (!proposal) return Response.json({ error: "Propuesta no encontrada." }, { status: 404 });
    if (proposal.status !== "pending") {
      return Response.json({ error: `Esta propuesta ya fue ${proposal.status === "approved" ? "aprobada" : "rechazada"}.` }, { status: 400 });
    }

    const decided: RuleProposal = { ...proposal, status: body.action === "approve" ? "approved" : "rejected", decidedAt: now };
    const proposals = file.proposals.map((p) => (p.id === decided.id ? decided : p));
    const active = body.action === "approve"
      ? { ...file.active, [decided.ruleKey]: decided.proposedValue }
      : file.active;

    const saved = await saveScannerRules({ active, proposals });
    return Response.json({ active: saved.active, proposals: saved.proposals });
  }

  return Response.json({ error: "Acción desconocida." }, { status: 400 });
}
