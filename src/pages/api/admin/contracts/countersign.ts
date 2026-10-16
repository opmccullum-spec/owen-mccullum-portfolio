export const prerender = false;

import type { APIRoute } from "astro";
import { createHash } from "node:crypto";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { countersignPdf } from "../../../../lib/contractPdf";
import { sendEmail } from "../../../../lib/resend";
import { contractFullySignedClientEmail, contractFullySignedOwnerEmail } from "../../../../lib/emailTemplates";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Owen's countersignature on a contract the client has already signed.
// Stamps his typed signature onto the client-signed PDF and appends a record
// page, then stores the result as a SEPARATE file — the client-signed PDF
// and its fingerprint are left untouched so each stays independently
// verifiable.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const contractId = String(form.get("contractId") ?? "").trim();
  const signatureName = String(form.get("signatureName") ?? "").trim();
  const consent = form.get("consent") === "on";

  if (!UUID_RE.test(contractId)) return redirect("/admin");
  const back = `/admin/contracts/${contractId}/countersign`;
  if (!signatureName || !consent) return redirect(`${back}?error=invalid`);

  const { data: contract } = await supabaseAdmin
    .from("contracts")
    .select("id, title, status, signed_pdf_sha256, countersigned_at, prefill_fields, profiles(email, full_name)")
    .eq("id", contractId)
    .maybeSingle();
  if (!contract || contract.status !== "signed" || contract.countersigned_at) return redirect(back);

  try {
    const { data: file, error: downloadErr } = await supabaseAdmin.storage
      .from("signed-contracts")
      .download(`${contract.id}.pdf`);
    if (downloadErr || !file) throw downloadErr ?? new Error("client-signed PDF not found in storage");

    const clientSignedBytes = new Uint8Array(await file.arrayBuffer());
    const clientSignedSha256 = createHash("sha256").update(clientSignedBytes).digest("hex");

    // Refuse to countersign a file that no longer matches the fingerprint
    // recorded when the client signed it.
    if (contract.signed_pdf_sha256 && contract.signed_pdf_sha256 !== clientSignedSha256) {
      console.error("countersign refused: stored client-signed PDF doesn't match its recorded SHA-256", contract.id);
      return redirect(`${back}?error=integrity`);
    }

    const signedAtISO = new Date().toISOString();
    const signerIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const signerUserAgent = request.headers.get("user-agent") || "unknown";

    const finalBytes = await countersignPdf({
      pdfBytes: clientSignedBytes,
      title: contract.title,
      signatureName,
      signedAtISO,
      signerIp,
      signerUserAgent,
      clientSignedSha256,
    });
    const countersignedSha256 = createHash("sha256").update(finalBytes).digest("hex");

    const path = `${contract.id}-countersigned.pdf`;
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("signed-contracts")
      .upload(path, finalBytes, { contentType: "application/pdf", upsert: true });
    if (uploadErr) throw uploadErr;
    const { data: pub } = supabaseAdmin.storage.from("signed-contracts").getPublicUrl(path);

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("contracts")
      .update({
        countersigned_at: signedAtISO,
        countersigner_ip: signerIp,
        countersigner_user_agent: signerUserAgent,
        countersigned_pdf_url: pub.publicUrl,
        countersigned_pdf_sha256: countersignedSha256,
      })
      .eq("id", contract.id)
      .eq("status", "signed")
      .is("countersigned_at", null)
      .select("id")
      .maybeSingle();
    if (updateErr) throw updateErr;

    if (!updated) return redirect(back);

    // Send the client their fully signed copy. Best-effort, like every other
    // email here: a failure is reported back to Owen rather than undoing a
    // signature that's already been recorded.
    let emailed = false;
    try {
      const fields = contract.prefill_fields as { clientName?: string; email?: string } | null;
      const to = contract.profiles?.email || fields?.email;
      if (to) {
        const origin = new URL(request.url).origin;
        const { subject, html } = contractFullySignedClientEmail({
          clientName: fields?.clientName || contract.profiles?.full_name || "there",
          title: contract.title,
          viewUrl: pub.publicUrl,
          portalUrl: `${origin}/portal`,
        });
        const filename = `${contract.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "signed-agreement"}-signed.pdf`;
        await sendEmail({ to, subject, html, attachments: [{ filename, content: finalBytes }] });
        emailed = true;
      }
    } catch (err) {
      console.error("failed to email client their fully signed copy:", err instanceof Error ? err.message : err);
    }

    // Owen gets his own copy of the fully signed agreement too.
    try {
      const fields = contract.prefill_fields as { clientName?: string } | null;
      const { subject, html } = contractFullySignedOwnerEmail({
        clientName: fields?.clientName || contract.profiles?.full_name || "the client",
        title: contract.title,
        viewUrl: pub.publicUrl,
      });
      const filename = `${contract.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "signed-agreement"}-signed.pdf`;
      await sendEmail({ to: import.meta.env.OWNER_EMAIL, subject, html, attachments: [{ filename, content: finalBytes }] });
    } catch (err) {
      console.error("failed to email owner the fully signed copy:", err instanceof Error ? err.message : err);
    }

    return redirect(`/admin?countersigned=1${emailed ? "" : "&emailed=0"}`);
  } catch (err) {
    console.error("countersign failed:", err instanceof Error ? err.message : err);
    return redirect(`${back}?error=failed`);
  }
};
