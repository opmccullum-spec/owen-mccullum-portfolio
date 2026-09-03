export const prerender = false;

import crypto from "node:crypto";
import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase/admin";

// Documenso verifies webhooks via a plain shared-secret header (not an
// HMAC signature like Stripe) — compare with constant time to avoid
// leaking the secret through response-time differences.
function isValidSecret(received: string | null, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export const POST: APIRoute = async ({ request }) => {
  const secret = request.headers.get("x-documenso-secret");
  if (!isValidSecret(secret, import.meta.env.DOCUMENSO_WEBHOOK_SECRET)) {
    return new Response("invalid signature", { status: 401 });
  }

  const body = await request.json().catch(() => null);
  console.log("Documenso webhook body:", JSON.stringify(body, null, 2));
  const event = body?.event;
  const externalId = body?.payload?.externalId;

  if (event === "document.completed" && externalId) {
    const { error } = await supabaseAdmin.from("contracts").update({ status: "signed" }).eq("id", externalId);
    if (error) console.error("failed to mark contract signed:", error);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
};
