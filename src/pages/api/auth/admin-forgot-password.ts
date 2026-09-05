export const prerender = false;

import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, cookies, url }) => {
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
