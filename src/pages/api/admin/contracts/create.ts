export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { findOrCreateClient } from "../../../../lib/supabase/findOrCreateClient";
import { getTemplate, useTemplate } from "../../../../lib/documenso";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const templateId = import.meta.env.DOCUMENSO_TEMPLATE_ID;
  if (!templateId) return redirect("/admin/contracts/new?error=not_configured");

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const title = String(form.get("title") ?? "").trim();

  if (!EMAIL_RE.test(email) || !title) {
    return redirect("/admin/contracts/new?error=create_failed");
  }

  const prefillFields = [...form.entries()]
    .filter(([key]) => key.startsWith("field:"))
    .map(([key, value]) => ({ fieldId: Number(key.slice("field:".length)), value: String(value) }))
    .filter((f) => f.value.trim().length > 0);

  try {
    const authUser = await findOrCreateClient(email);

    const template = await getTemplate(Number(templateId));
    // v1 scope: assumes a single client-signer role on the template. If
    // Owen's template ever needs more than one signer, this needs revisiting.
    const signerRecipient = template.recipients.find((r) => r.role === "SIGNER") ?? template.recipients[0];
    if (!signerRecipient) throw new Error("template has no recipients configured");

    const contractId = crypto.randomUUID();

    const result = await useTemplate({
      templateId: Number(templateId),
      recipients: [{ id: signerRecipient.id, email, name: authUser.email ?? email }],
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
      signing_url: recipient?.signingUrl ?? null,
    });
    if (insertErr) throw insertErr;

    return redirect("/admin?contracted=1");
  } catch (err) {
    console.error("create contract failed:", err);
    return redirect("/admin/contracts/new?error=create_failed");
  }
};
