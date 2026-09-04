export const prerender = false;

import type { APIRoute } from "astro";
import { requireUserApi } from "../../../lib/auth";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import { deleteEvent } from "../../../lib/googleCalendar";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireUserApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const bookingId = String(form.get("bookingId") ?? "");

  const { data: booking, error: findErr } = await supabaseAdmin
    .from("bookings")
    .select("id, client_id, google_event_id, status")
    .eq("id", bookingId)
    .single();

  if (findErr || !booking || booking.client_id !== auth.user.id) {
    return redirect("/portal?error=cancel_failed");
  }

  try {
    if (booking.google_event_id) {
      await deleteEvent(booking.google_event_id);
    }
    const { error: updateErr } = await supabaseAdmin
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", booking.id);
    if (updateErr) throw updateErr;

    return redirect("/portal?cancelled=1");
  } catch (err) {
    console.error("client booking cancel failed:", err instanceof Error ? err.message : err);
    return redirect("/portal?error=cancel_failed");
  }
};
