export const prerender = false;

import type { APIRoute } from "astro";
import { requireUserApi } from "../../../lib/auth";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import { deleteEvent } from "../../../lib/googleCalendar";
import { sendEmail } from "../../../lib/resend";
import { bookingCancelledByClientOwnerEmail } from "../../../lib/emailTemplates";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireUserApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const bookingId = String(form.get("bookingId") ?? "");

  const { data: booking, error: findErr } = await supabaseAdmin
    .from("bookings")
    .select("id, client_id, starts_at, ends_at, google_event_id, status")
    .eq("id", bookingId)
    .single();

  if (
    findErr ||
    !booking ||
    booking.client_id !== auth.user.id ||
    !(booking.status === "pending" || booking.status === "confirmed")
  ) {
    return redirect("/portal?error=cancel_failed");
  }

  try {
    if (booking.google_event_id) {
      await deleteEvent(booking.google_event_id);
    }
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", booking.id)
      .in("status", ["pending", "confirmed"])
      .select("id")
      .maybeSingle();
    if (updateErr) throw updateErr;

    if (updated) {
      try {
        const { data: settings } = await supabaseAdmin.from("booking_settings").select("timezone").eq("id", 1).single();
        const { subject, html } = bookingCancelledByClientOwnerEmail({
          clientName: auth.profile.full_name || auth.profile.email,
          clientEmail: auth.profile.email,
          startISO: booking.starts_at,
          endISO: booking.ends_at,
          timezone: settings?.timezone ?? "America/New_York",
        });
        await sendEmail({ to: import.meta.env.OWNER_EMAIL, subject, html });
      } catch (err) {
        console.error("failed to email owner about client cancellation:", err instanceof Error ? err.message : err);
      }
    }

    return redirect("/portal?cancelled=1");
  } catch (err) {
    console.error("client booking cancel failed:", err instanceof Error ? err.message : err);
    return redirect("/portal?error=cancel_failed");
  }
};
