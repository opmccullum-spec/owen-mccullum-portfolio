export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { ensureProfile } from "../../../../lib/supabase/ensureProfile";
import { stripe } from "../../../../lib/stripe";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Find the Supabase auth user for this email, creating one if it doesn't
// exist yet — lets Owen invoice anyone, not just clients who've already
// logged into the portal. Known limitation: the "already exists" fallback
// only searches the first 1000 users, fine at this business's scale.
async function findOrCreateAuthUser(email: string) {
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (!createErr) return created.user;

  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email === email);
  if (!existing) throw createErr;
  return existing;
}

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
  const description = String(form.get("description") ?? "").trim();
  const amountDollars = parseFloat(String(form.get("amount") ?? ""));
  const dueDate = String(form.get("dueDate") ?? "");

  if (!EMAIL_RE.test(email) || !description || !(amountDollars > 0) || !dueDate) {
    return redirect("/admin/invoices/new?error=create_failed");
  }

  const amountCents = Math.round(amountDollars * 100);
  const daysUntilDue = Math.max(1, Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86_400_000));

  try {
    const authUser = await findOrCreateAuthUser(email);
    await ensureProfile(authUser);
    const customerId = await findOrCreateStripeCustomer(authUser.id, email);

    // Create the (empty) invoice first, then attach the line item to it
    // explicitly via `invoice: draft.id` — relying on Stripe to
    // auto-attach "pending" items created beforehand is version-dependent
    // and silently produced a $0 invoice in testing.
    const draft = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: daysUntilDue,
      auto_advance: true,
    });

    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: draft.id,
      amount: amountCents,
      currency: "usd",
      description,
    });

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
      stripe_invoice_id: invoice.id,
      description,
      amount_cents: amountCents,
      status: "sent",
      due_date: dueDate,
      hosted_invoice_url: invoice.hosted_invoice_url,
    });
    if (insertErr) throw insertErr;

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
