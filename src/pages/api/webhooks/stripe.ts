export const prerender = false;

import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import { stripe } from "../../../lib/stripe";
import { sendEmail } from "../../../lib/resend";
import { invoicePaidOwnerEmail } from "../../../lib/emailTemplates";

export const POST: APIRoute = async ({ request }) => {
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  if (!signature) {
    return new Response("missing signature", { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, import.meta.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("stripe webhook signature verification failed:", err);
    return new Response("invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "invoice.paid": {
      const invoice = event.data.object;
      // .neq(...) + returning the row guards against Stripe redelivering
      // this event (it retries on a slow/non-2xx response) — a redelivery
      // finds no row still in "draft"/"sent" and skips the email.
      const { data: updated, error } = await supabaseAdmin
        .from("invoices")
        .update({ status: "paid" })
        .eq("stripe_invoice_id", invoice.id)
        .neq("status", "paid")
        .select("description, amount_cents, profiles(email, full_name)")
        .maybeSingle();
      if (error) console.error("failed to mark invoice paid:", error);

      if (updated) {
        const client = updated.profiles as unknown as { email: string; full_name: string | null } | null;
        try {
          const { subject, html } = invoicePaidOwnerEmail({
            clientName: client?.full_name || client?.email || "a client",
            description: updated.description,
            amountCents: updated.amount_cents,
          });
          await sendEmail({ to: import.meta.env.OWNER_EMAIL, subject, html });
        } catch (err) {
          console.error("failed to email owner about paid invoice:", err instanceof Error ? err.message : err);
        }
      }
      break;
    }
    case "invoice.voided": {
      const invoice = event.data.object;
      const { error } = await supabaseAdmin.from("invoices").update({ status: "void" }).eq("stripe_invoice_id", invoice.id);
      if (error) console.error("failed to mark invoice void:", error);
      break;
    }
    default:
      // Nothing to do for other event types — 200 anyway so Stripe doesn't retry.
      break;
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
};
