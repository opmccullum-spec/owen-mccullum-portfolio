export const prerender = false;

import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { verifyTurnstile } from "../../../lib/turnstile";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, cookies, url, clientAddress }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_body" }), { status: 400 });
  }

  const email = typeof body === "object" && body && "email" in body ? String((body as any).email).trim() : "";
  if (!EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid_email" }), { status: 400 });
  }

  // Anyone can submit this form, and it emails a reset link to the admin
  // address — without a check, a bot could flood Owen's inbox with them.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || clientAddress || null;
  const turnstileToken = typeof body === "object" && body && "turnstileToken" in body ? (body as any).turnstileToken : null;
  if (!(await verifyTurnstile(turnstileToken, ip))) {
    return new Response(JSON.stringify({ ok: false, error: "captcha_failed" }), { status: 400 });
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL("/admin/reset-password", url).toString(),
  });

  // Always report success, whether or not that email actually has an
  // account — otherwise this endpoint becomes a way to check which emails
  // are registered.
  if (error) console.error("resetPasswordForEmail failed:", error.status, error.code, error.message);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
