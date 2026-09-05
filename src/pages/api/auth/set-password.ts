export const prerender = false;

import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_body" }), { status: 400 });
  }

  const password = typeof body === "object" && body && "password" in body ? String((body as any).password) : "";
  if (password.length < 8) {
    return new Response(JSON.stringify({ ok: false, error: "password_too_short" }), { status: 400 });
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("updateUser (set password) failed:", error.status, error.code, error.message);
    return new Response(JSON.stringify({ ok: false, error: "update_failed" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
