export const prerender = false;

import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_body" }), { status: 400 });
  }

  const get = (key: string) => (typeof body === "object" && body && key in body ? String((body as any)[key]) : "");
  const email = get("email").trim();
  const password = get("password");

  if (!EMAIL_RE.test(email) || !password) {
    return new Response(JSON.stringify({ ok: false, error: "invalid_input" }), { status: 400 });
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return new Response(JSON.stringify({ ok: false, error: "invalid_credentials" }), { status: 401 });
  }

  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", data.user.id).single();

  // Signing in successfully with a password doesn't make someone an admin —
  // only the profiles row does. Bounce anyone else straight back out.
  if (!profile?.is_admin) {
    await supabase.auth.signOut();
    return new Response(JSON.stringify({ ok: false, error: "not_admin" }), { status: 403 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
