export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi, safeRedirectPath } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { cancelDocument } from "../../../../lib/documenso";

// Cancelling never deletes the row — it marks our own row `voided` (so it
// stays visible, struck-through, in the admin views and hidden from the
// client's own portal) and best-effort cancels the document on Documenso's
// side too. Only ever allowed while the contract is still `sent` and
// unsigned: once a client has signed, it's a legally executed document and
// this app has no path to touch it.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const contractId = String(form.get("contractId") ?? "");
  const back = safeRedirectPath(String(form.get("redirectTo") ?? "")) ?? "/admin";

  const { data: contract, error: findErr } = await supabaseAdmin
    .from("contracts")
    .select("id, documenso_document_id, status")
    .eq("id", contractId)
    .eq("status", "sent")
    .maybeSingle();
  if (findErr || !contract) {
    return redirect(`${back}${back.includes("?") ? "&" : "?"}error=contract_not_cancellable`);
  }

  try {
    if (contract.documenso_document_id) {
      try {
        await cancelDocument(contract.documenso_document_id);
      } catch (err) {
        // Non-fatal — see the cancelDocument doc comment. Our own record of
        // the cancellation below is what the rest of this app trusts either
        // way; worst case the stale link still resolves on Documenso's side.
        console.error(
          "documenso cancel failed (continuing to mark cancelled on our side):",
          err instanceof Error ? err.message : err,
        );
      }
    }

    const { error: updateErr } = await supabaseAdmin
      .from("contracts")
      .update({ status: "voided" })
      .eq("id", contract.id)
      .eq("status", "sent");
    if (updateErr) throw updateErr;

    return redirect(`${back}${back.includes("?") ? "&" : "?"}contract_cancelled=1`);
  } catch (err) {
    console.error("cancel contract failed:", err instanceof Error ? err.message : err);
    return redirect(`${back}${back.includes("?") ? "&" : "?"}error=contract_cancel_failed`);
  }
};
