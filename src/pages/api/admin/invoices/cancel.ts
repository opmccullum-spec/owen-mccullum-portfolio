export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi, safeRedirectPath } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { stripe } from "../../../../lib/stripe";
import { sendEmail } from "../../../../lib/resend";
import { invoiceCancelledClientEmail } from "../../../../lib/emailTemplates";

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
    .select("id, stripe_invoice_id, status, description, amount_cents, due_date, profiles(email, full_name)")
    .eq("id", invoiceId)
    .eq("status", "sent")
    .maybeSingle();
  if (findErr || !invoice) {
    return redirect(`${back}${back.includes("?") ? "&" : "?"}error=invoice_not_cancellable`);
  }

  try {
    let invoiceNumber: string | null = null;
    if (invoice.stripe_invoice_id) {
      const voided = await stripe.invoices.voidInvoice(invoice.stripe_invoice_id);
      invoiceNumber = voided.number ?? null;
    }
    const { error: updateErr } = await supabaseAdmin
      .from("invoices")
      .update({ status: "void" })
      .eq("id", invoice.id)
      .eq("status", "sent");
    if (updateErr) throw updateErr;

    // Tell the client which invoice was cancelled. Best-effort: the
    // cancellation itself has already happened either way.
    let notified = false;
    try {
      const client = invoice.profiles as unknown as { email: string; full_name: string | null } | null;
      if (client?.email) {
        const { subject, html } = invoiceCancelledClientEmail({
          clientName: client.full_name || "there",
          description: invoice.description,
          amountCents: invoice.amount_cents,
          invoiceNumber,
          dueDate: invoice.due_date,
        });
        await sendEmail({ to: client.email, subject, html });
        notified = true;
      }
    } catch (err) {
      console.error("failed to email client about cancelled invoice:", err instanceof Error ? err.message : err);
    }

    return redirect(`${back}${back.includes("?") ? "&" : "?"}invoice_cancelled=1${notified ? "" : "&notified=0"}`);
  } catch (err) {
    console.error("cancel invoice failed:", err instanceof Error ? err.message : err);
    return redirect(`${back}${back.includes("?") ? "&" : "?"}error=invoice_cancel_failed`);
  }
};
