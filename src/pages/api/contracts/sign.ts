export const prerender = false;

import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import { generateSignedPdf, type ContractPrefillFields } from "../../../lib/contractPdf";
import { sendEmail } from "../../../lib/resend";
import { contractSignedOwnerEmail } from "../../../lib/emailTemplates";

// Public, token-gated (no login) — anyone holding the emailed sign_token
// can sign that one contract. Guarded by `.eq("status", "sent")` on both
// the lookup and the final update so a resubmit/double-click, or a token
// for an already-signed or voided contract, can never re-sign or overwrite
// a completed document.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const signatureName = String(form.get("signatureName") ?? "").trim();
  const consent = form.get("consent") === "on";

  if (!token || !signatureName || !consent) {
    return redirect(`/contracts/sign/${token}?error=invalid`);
  }

  const { data: contract, error: findErr } = await supabaseAdmin
    .from("contracts")
    .select("id, title, client_id, prefill_fields, status")
    .eq("sign_token", token)
    .eq("status", "sent")
    .maybeSingle();
  if (findErr || !contract) {
    return redirect(`/contracts/sign/${token}?error=sign_failed`);
  }

  try {
    const signedAtISO = new Date().toISOString();
    const signerIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const signerUserAgent = request.headers.get("user-agent") || "unknown";
    const prefillFields = contract.prefill_fields as ContractPrefillFields;

    const pdfBytes = await generateSignedPdf({
      title: contract.title,
      prefillFields,
      signatureName,
      signedAtISO,
      signerIp,
      signerUserAgent,
    });

    const { error: uploadErr } = await supabaseAdmin.storage
      .from("signed-contracts")
      .upload(`${contract.id}.pdf`, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: pub } = supabaseAdmin.storage.from("signed-contracts").getPublicUrl(`${contract.id}.pdf`);

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("contracts")
      .update({
        status: "signed",
        signed_at: signedAtISO,
        signer_ip: signerIp,
        signer_user_agent: signerUserAgent,
        signed_pdf_url: pub.publicUrl,
      })
      .eq("id", contract.id)
      .eq("status", "sent")
      .select("id")
      .maybeSingle();
    if (updateErr) throw updateErr;

    if (updated) {
      try {
        const { subject, html } = contractSignedOwnerEmail({ clientName: signatureName, title: contract.title });
        await sendEmail({ to: import.meta.env.OWNER_EMAIL, subject, html });
      } catch (err) {
        console.error("failed to email owner about signed contract:", err instanceof Error ? err.message : err);
      }
    }

    return redirect(`/contracts/sign/${token}`);
  } catch (err) {
    console.error("sign contract failed:", err instanceof Error ? err.message : err);
    return redirect(`/contracts/sign/${token}?error=sign_failed`);
  }
};
