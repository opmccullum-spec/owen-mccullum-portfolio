export const prerender = false;

import crypto from "node:crypto";
import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import { sendEmail } from "../../../lib/resend";
import { contractSignedOwnerEmail } from "../../../lib/emailTemplates";

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
  const event = body?.event;
  const externalId = body?.payload?.externalId;

  // Confirmed live against a real webhook delivery: the wire payload's
  // event field is SCREAMING_SNAKE_CASE ("DOCUMENT_COMPLETED"), not the
  // dotted/lowercase form shown in Documenso's trigger picker UI
  // ("document.completed") — that's just a display label.
  if (event === "DOCUMENT_COMPLETED" && externalId) {
    // .neq(...) + returning the row guards against Documenso redelivering
    // this event on a slow/non-2xx response.
    const { data: updated, error } = await supabaseAdmin
      .from("contracts")
      .update({ status: "signed" })
      .eq("id", externalId)
      .neq("status", "signed")
      .select("title, profiles(email, full_name)")
      .maybeSingle();
    if (error) console.error("failed to mark contract signed:", error);

    if (updated) {
      const client = updated.profiles as unknown as { email: string; full_name: string | null } | null;
      try {
        const { subject, html } = contractSignedOwnerEmail({
          clientName: client?.full_name || client?.email || "a client",
          title: updated.title,
        });
        await sendEmail({ to: import.meta.env.OWNER_EMAIL, subject, html });
      } catch (err) {
        console.error("failed to email owner about signed contract:", err instanceof Error ? err.message : err);
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
};
