export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { findOrCreateClient } from "../../../../lib/supabase/findOrCreateClient";
import { stripe } from "../../../../lib/stripe";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findOrCreateStripeCustomer(userId: string, email: string) {
  const { data: profile } = await supabaseAdmin.from("profiles").select("stripe_customer_id").eq("id", userId).single();
  if (profile?.stripe_customer_id) return profile.stripe_customer_id;

  const customer = await stripe.customers.create({ email });
  await supabaseAdmin.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", userId);
  return customer.id;
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const dueDate = String(form.get("dueDate") ?? "");
  const bookingId = String(form.get("bookingId") ?? "").trim() || null;
  if (bookingId && !UUID_RE.test(bookingId)) {
    return redirect("/admin/invoices/new?error=create_failed");
  }
  // Set only when this submission is "editing" an existing invoice — Stripe
  // won't let a sent invoice's total change, so editing means: create the
  // corrected invoice below, and only once that succeeds, void the original.
  const voidInvoiceId = String(form.get("voidInvoiceId") ?? "").trim() || null;
  if (voidInvoiceId && !UUID_RE.test(voidInvoiceId)) {
    return redirect("/admin/invoices/new?error=create_failed");
  }

  const itemDescriptions = form.getAll("itemDescription[]").map((v) => String(v).trim());
  const itemAmounts = form.getAll("itemAmount[]").map((v) => parseFloat(String(v)));
  const items = itemDescriptions
    .map((description, i) => ({ description, amountDollars: itemAmounts[i] }))
    .filter((item) => item.description && item.amountDollars > 0);

  if (!EMAIL_RE.test(email) || !items.length || !dueDate) {
    return redirect("/admin/invoices/new?error=create_failed");
  }

  const lineItems = items.map((item) => ({ description: item.description, amountCents: Math.round(item.amountDollars * 100) }));
  const amountCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);
  const description = lineItems.map((item) => item.description).join("; ");
  const daysUntilDue = Math.max(1, Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86_400_000));

  try {
    const authUser = await findOrCreateClient(email);

    // If a shoot was chosen, make sure it exists (and, defensively, that it
    // belongs to this same client) before linking the invoice to it.
    if (bookingId) {
      const { data: bk } = await supabaseAdmin
        .from("bookings")
        .select("id, client_id")
        .eq("id", bookingId)
        .maybeSingle();
      if (!bk || bk.client_id !== authUser.id) {
        return redirect("/admin/invoices/new?error=create_failed");
      }
    }

    // Same defensive check for the invoice being replaced, if any — it must
    // belong to this client and still be cancellable (unpaid).
    let oldStripeInvoiceId: string | null = null;
    if (voidInvoiceId) {
      const { data: old } = await supabaseAdmin
        .from("invoices")
        .select("id, client_id, stripe_invoice_id, status")
        .eq("id", voidInvoiceId)
        .eq("status", "sent")
        .maybeSingle();
      if (!old || old.client_id !== authUser.id) {
        return redirect("/admin/invoices/new?error=create_failed");
      }
      oldStripeInvoiceId = old.stripe_invoice_id;
    }

    const customerId = await findOrCreateStripeCustomer(authUser.id, email);

    // Create the (empty) invoice first, then attach each line item to it
    // explicitly via `invoice: draft.id` — relying on Stripe to
    // auto-attach "pending" items created beforehand is version-dependent
    // and silently produced a $0 invoice in testing.
    const draft = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: daysUntilDue,
      auto_advance: true,
    });

    for (const item of lineItems) {
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: draft.id,
        amount: item.amountCents,
        currency: "usd",
        description: item.description,
      });
    }

    let invoice = await stripe.invoices.finalizeInvoice(draft.id!);

    // Finalizing already produces a working hosted_invoice_url — sendInvoice
    // just asks Stripe to email it too, which some brand-new/barely-set-up
    // Stripe accounts reject ("cannot be sent right now") until basic
    // account setup is completed. Don't let that block invoice creation —
    // fall back to a link Owen can share manually.
    let emailed = true;
    try {
      invoice = await stripe.invoices.sendInvoice(invoice.id!);
    } catch (sendErr) {
      emailed = false;
      console.error("stripe could not auto-email this invoice (account setup incomplete?):", sendErr);
    }

    const { error: insertErr } = await supabaseAdmin.from("invoices").insert({
      client_id: authUser.id,
      booking_id: bookingId,
      stripe_invoice_id: invoice.id,
      description,
      amount_cents: amountCents,
      status: "sent",
      due_date: dueDate,
      hosted_invoice_url: invoice.hosted_invoice_url,
    });
    if (insertErr) throw insertErr;

    // Only void the original now that its replacement is safely created and
    // sent — never the other way around, so a failure above never leaves
    // the client with no live invoice at all.
    if (voidInvoiceId) {
      try {
        if (oldStripeInvoiceId) await stripe.invoices.voidInvoice(oldStripeInvoiceId);
        await supabaseAdmin.from("invoices").update({ status: "void" }).eq("id", voidInvoiceId).eq("status", "sent");
      } catch (err) {
        console.error(
          "replacement invoice sent, but voiding the original failed — cancel it manually:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    const params = new URLSearchParams({ invoiced: "1" });
    if (!emailed) {
      params.set("emailed", "0");
      params.set("url", invoice.hosted_invoice_url ?? "");
    }
    return redirect(`/admin?${params.toString()}`);
  } catch (err) {
    console.error("create invoice failed:", err);
    return redirect("/admin/invoices/new?error=create_failed");
  }
};
