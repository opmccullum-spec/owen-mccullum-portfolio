export const prerender = false;

import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { safeRedirectPath } from "../../../lib/auth";

// Plain <form method="POST"> target — works with no client-side JS. Admin's
// sign-out form passes redirectTo=/admin/login so admins land back on their
// own login page, not the client one; the client portal's form omits it and
// keeps the old default.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const supabase = createSupabaseServerClient(request, cookies);
  await supabase.auth.signOut();
  const form = await request.formData().catch(() => null);
  const target = safeRedirectPath(form?.get("redirectTo")?.toString()) ?? "/portal/login";
  return redirect(target);
};
