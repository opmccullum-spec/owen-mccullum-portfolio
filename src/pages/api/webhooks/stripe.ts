export const prerender = false;

import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import { stripe } from "../../../lib/stripe";

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
      const { error } = await supabaseAdmin.from("invoices").update({ status: "paid" }).eq("stripe_invoice_id", invoice.id);
      if (error) console.error("failed to mark invoice paid:", error);
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
