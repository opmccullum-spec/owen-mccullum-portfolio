export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi, safeRedirectPath } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { stripe } from "../../../../lib/stripe";

// Cancelling never deletes the row — it voids the invoice in Stripe and
// marks our own row `void`, so it stays visible (struck-through) in the
// admin views and hidden from the client's own portal. Only ever allowed
// while the invoice is still `sent` and unpaid: once a client has paid,
// the amount is locked in for good.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const invoiceId = String(form.get("invoiceId") ?? "");
  const back = safeRedirectPath(String(form.get("redirectTo") ?? "")) ?? "/admin";

  const { data: invoice, error: findErr } = await supabaseAdmin
    .from("invoices")
    .select("id, stripe_invoice_id, status")
    .eq("id", invoiceId)
    .eq("status", "sent")
    .maybeSingle();
  if (findErr || !invoice) {
    return redirect(`${back}${back.includes("?") ? "&" : "?"}error=invoice_not_cancellable`);
  }

  try {
    if (invoice.stripe_invoice_id) {
      await stripe.invoices.voidInvoice(invoice.stripe_invoice_id);
    }
    const { error: updateErr } = await supabaseAdmin
      .from("invoices")
      .update({ status: "void" })
      .eq("id", invoice.id)
      .eq("status", "sent");
    if (updateErr) throw updateErr;

    return redirect(`${back}${back.includes("?") ? "&" : "?"}invoice_cancelled=1`);
  } catch (err) {
    console.error("cancel invoice failed:", err instanceof Error ? err.message : err);
    return redirect(`${back}${back.includes("?") ? "&" : "?"}error=invoice_cancel_failed`);
  }
};
