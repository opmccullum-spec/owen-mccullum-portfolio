export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { deleteEvent } from "../../../../lib/googleCalendar";
import { sendEmail } from "../../../../lib/resend";
import { bookingCancelledByAdminEmail } from "../../../../lib/emailTemplates";

// For an already-confirmed booking — see decline.ts for a still-pending one.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const bookingId = String(form.get("bookingId") ?? "");

  // Only act on a booking that's actually still confirmed — guards against
  // a double form-submit both re-deleting an already-gone calendar event
  // and sending the client a second "cancelled" email.
  const { data: booking, error: findErr } = await supabaseAdmin
    .from("bookings")
    .select("id, starts_at, ends_at, google_event_id, profiles(email, full_name)")
    .eq("id", bookingId)
    .eq("status", "confirmed")
    .maybeSingle();
  if (findErr || !booking) return redirect("/admin?error=booking_not_found");

  try {
    if (booking.google_event_id) {
      await deleteEvent(booking.google_event_id);
    }
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", booking.id)
      .eq("status", "confirmed")
      .select("id")
      .maybeSingle();
    if (updateErr) throw updateErr;

    const client = booking.profiles as unknown as { email: string; full_name: string | null } | null;
    if (updated && client?.email) {
      try {
        const { data: settings } = await supabaseAdmin.from("booking_settings").select("timezone").eq("id", 1).single();
        const { subject, html } = bookingCancelledByAdminEmail({
          clientName: client.full_name || client.email,
          startISO: booking.starts_at,
          endISO: booking.ends_at,
          timezone: settings?.timezone ?? "America/New_York",
        });
        await sendEmail({ to: client.email, subject, html });
      } catch (err) {
        console.error("failed to email client about cancelled booking:", err instanceof Error ? err.message : err);
      }
    }

    return redirect("/admin?cancelled=1");
  } catch (err) {
    console.error("admin booking cancel failed:", err instanceof Error ? err.message : err);
    return redirect("/admin?error=cancel_failed");
  }
};
