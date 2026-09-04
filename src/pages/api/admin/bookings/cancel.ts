export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { deleteEvent } from "../../../../lib/googleCalendar";

// For an already-confirmed booking — see decline.ts for a still-pending one.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const bookingId = String(form.get("bookingId") ?? "");

  const { data: booking, error: findErr } = await supabaseAdmin
    .from("bookings")
    .select("id, google_event_id")
    .eq("id", bookingId)
    .single();
  if (findErr || !booking) return redirect("/admin?error=booking_not_found");

  try {
    if (booking.google_event_id) {
      await deleteEvent(booking.google_event_id);
    }
    const { error: updateErr } = await supabaseAdmin.from("bookings").update({ status: "cancelled" }).eq("id", booking.id);
    if (updateErr) throw updateErr;

    return redirect("/admin?cancelled=1");
  } catch (err) {
    console.error("admin booking cancel failed:", err instanceof Error ? err.message : err);
    return redirect("/admin?error=cancel_failed");
  }
};
