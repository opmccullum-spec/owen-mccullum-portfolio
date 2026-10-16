export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Marks a shoot's photos as delivered, which clears its "send the photos"
// reminder from the admin message board.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const bookingId = String(form.get("bookingId") ?? "");
  if (!UUID_RE.test(bookingId)) return redirect("/admin?error=photos_failed");

  const { error } = await supabaseAdmin
    .from("bookings")
    .update({ photos_sent_at: new Date().toISOString() })
    .eq("id", bookingId)
    .is("photos_sent_at", null);
  if (error) {
    console.error("mark photos sent failed:", error.message);
    return redirect("/admin?error=photos_failed");
  }
  return redirect("/admin?photos_sent=1");
};
