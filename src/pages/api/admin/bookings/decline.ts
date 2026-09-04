export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const bookingId = String(form.get("bookingId") ?? "");

  // Never made it to Google Calendar, so declining is just a status flip.
  const { error } = await supabaseAdmin
    .from("bookings")
    .update({ status: "declined" })
    .eq("id", bookingId)
    .eq("status", "pending");

  if (error) {
    console.error("booking decline failed:", error.message);
    return redirect("/admin?error=decline_failed");
  }

  return redirect("/admin?declined=1");
};
