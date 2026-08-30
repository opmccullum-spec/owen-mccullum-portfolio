export const prerender = false;

import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { ensureProfile } from "../../../lib/supabase/ensureProfile";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Alternative to clicking the emailed link: type in the 6-digit code from
// the same email instead. This exists because email providers (Gmail
// included) sometimes pre-fetch links to scan them for safety, silently
// burning the one-time link before a person ever clicks it — a code can't
// be pre-fetched the same way. Works from any device/browser, unlike the
// link (which must be opened in the same browser session that requested
// it, since that's where the PKCE handshake lives).
export const POST: APIRoute = async ({ request, cookies }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_body" }), { status: 400 });
  }

  const email =
    typeof body === "object" && body && "email" in body ? String((body as any).email).trim() : "";
  const token =
    typeof body === "object" && body && "token" in body ? String((body as any).token).trim() : "";

  if (!EMAIL_RE.test(email) || !/^\d{6,8}$/.test(token)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid_input" }), { status: 400 });
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error || !data.user) {
    console.error("verifyOtp failed:", error?.status, error?.code, error?.message);
    return new Response(JSON.stringify({ ok: false, error: "verify_failed" }), { status: 400 });
  }

  await ensureProfile(data.user);

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
