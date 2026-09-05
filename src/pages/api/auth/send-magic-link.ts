export const prerender = false;

import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { safeRedirectPath } from "../../../lib/auth";

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
  const next = safeRedirectPath(
    typeof body === "object" && body && "next" in body ? String((body as any).next) : null,
  );

  const supabase = createSupabaseServerClient(request, cookies);

  // Carry the original destination (e.g. /admin) through the emailed link
  // so /portal/auth/callback can send them back there, not just to /portal.
  const callbackUrl = new URL("/portal/auth/callback", url);
  if (next) callbackUrl.searchParams.set("next", next);

  // NOTE: shouldCreateUser defaults to true, so any email can self-register
  // by requesting a link. That's fine for now (RLS still confines everyone
  // to their own, empty data) but revisit once there's an admin "add
  // client" flow — at that point switch this to shouldCreateUser: false so
  // only clients Owen has already added can log in.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callbackUrl.toString(),
    },
  });

  if (error) {
    // Logged server-side only — the response to the browser stays generic
    // so we don't leak whether an account exists or Supabase-specific detail.
    console.error("signInWithOtp failed:", error.status, error.code, error.message);
    return new Response(JSON.stringify({ ok: false, error: "send_failed" }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
