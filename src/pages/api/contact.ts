export const prerender = false;

import type { APIRoute } from "astro";
import { sendEmail } from "../../lib/resend";
import { contactInquiryOwnerEmail } from "../../lib/emailTemplates";

// Replaces the old client-side Web3Forms integration, which silently
// stopped delivering (its API returned a success response either way, so
// the form always showed "sent" — the failure was invisible from the
// browser). Routes through the same Resend account + verified sending
// domain already proven reliable for booking emails, so there's one fewer
// third-party dependency and one fewer place for a silent failure to hide.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_TYPES = new Set(["Session", "Assignment", "Print", "General"]);

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ success: false, message: "Invalid request." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Honeypot — bots fill this field, humans never see it. Pretend success
  // either way so a bot can't learn its submission was rejected.
  if (String(body.honey ?? "").trim()) {
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const message = String(body.message ?? "").trim();
  const type = VALID_TYPES.has(String(body.type)) ? (String(body.type) as string) : "General";

  if (!name || !EMAIL_RE.test(email) || message.length < 10) {
    return new Response(JSON.stringify({ success: false, message: "Please fill out every field." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const ownerEmail = import.meta.env.OWNER_EMAIL;
    const { subject, html } = contactInquiryOwnerEmail({ name, email, type, message });
    await sendEmail({ to: ownerEmail, subject, html, replyTo: email });
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("contact form email failed:", err instanceof Error ? err.message : err);
    return new Response(
      JSON.stringify({ success: false, message: "Something went wrong. Please email Owen directly." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
