export const prerender = false;

import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

// Plain <form method="POST"> target — works with no client-side JS.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const supabase = createSupabaseServerClient(request, cookies);
  await supabase.auth.signOut();
  return redirect("/portal/login");
};
