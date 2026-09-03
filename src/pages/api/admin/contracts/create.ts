export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { findOrCreateClient } from "../../../../lib/supabase/findOrCreateClient";
import { getTemplate, useTemplate, CONTRACT_FIELDS, signingUrlFromToken } from "../../../../lib/documenso";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const templateId = import.meta.env.DOCUMENSO_TEMPLATE_ID;
  if (!templateId) return redirect("/admin/contracts/new?error=not_configured");

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const title = String(form.get("title") ?? "").trim();
  const clientName = String(form.get("clientName") ?? "").trim();
  const address = String(form.get("address") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  const sessionDate = String(form.get("sessionDate") ?? "").trim();
  const startEndTime = String(form.get("startEndTime") ?? "").trim();
  const location = String(form.get("location") ?? "").trim();
  const totalFee = parseFloat(String(form.get("totalFee") ?? ""));

  if (!EMAIL_RE.test(email) || !title || !clientName || !sessionDate || !(totalFee > 0)) {
    return redirect("/admin/contracts/new?error=create_failed");
  }

  const retainer = (totalFee * 0.2).toFixed(2);
  const balance = (totalFee * 0.8).toFixed(2);

  const prefillFields = (
    [
      [CONTRACT_FIELDS.clientName, clientName],
      [CONTRACT_FIELDS.clientNamePrint, clientName],
      [CONTRACT_FIELDS.address, address],
      [CONTRACT_FIELDS.email, email],
      [CONTRACT_FIELDS.phone, phone],
      [CONTRACT_FIELDS.sessionDate, sessionDate],
      [CONTRACT_FIELDS.startEndTime, startEndTime],
      [CONTRACT_FIELDS.location, location],
      [CONTRACT_FIELDS.totalFee, totalFee.toFixed(2)],
      [CONTRACT_FIELDS.retainer, retainer],
      [CONTRACT_FIELDS.balance, balance],
    ] as const
  )
    .filter(([, value]) => value.length > 0)
    .map(([id, value]) => ({ id, type: "text" as const, value }));

  try {
    const authUser = await findOrCreateClient(email);

    const template = await getTemplate(Number(templateId));
    const signerRecipient = template.recipients.find((r) => r.role === "SIGNER") ?? template.recipients[0];
    if (!signerRecipient) throw new Error("template has no recipients configured");

    const contractId = crypto.randomUUID();

    const result = await useTemplate({
      templateId: Number(templateId),
      recipients: [{ id: signerRecipient.id, email, name: clientName }],
      externalId: contractId,
      prefillFields,
    });

    const recipient = result.recipients.find((r) => r.id === signerRecipient.id) ?? result.recipients[0];

    const { error: insertErr } = await supabaseAdmin.from("contracts").insert({
      id: contractId,
      client_id: authUser.id,
      documenso_document_id: String(result.id),
      title,
      status: "sent",
      signing_url: recipient?.token ? signingUrlFromToken(recipient.token) : null,
    });
    if (insertErr) throw insertErr;

    return redirect("/admin?contracted=1");
  } catch (err) {
    console.error("create contract failed:", err instanceof Error ? err.message : err);
    if (err && typeof err === "object" && "body" in err) {
      console.error("Documenso error body:", JSON.stringify((err as { body: unknown }).body, null, 2));
    }
    return redirect("/admin/contracts/new?error=create_failed");
  }
};
