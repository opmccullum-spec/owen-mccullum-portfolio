export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { createEvent, isCalendarBusy } from "../../../../lib/googleCalendar";
import { sendEmail } from "../../../../lib/resend";
import { bookingConfirmedEmail } from "../../../../lib/emailTemplates";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const bookingId = String(form.get("bookingId") ?? "");

  const { data: booking, error: findErr } = await supabaseAdmin
    .from("bookings")
    .select("id, starts_at, ends_at, status, profiles(email, full_name)")
    .eq("id", bookingId)
    .single();

  if (findErr || !booking) return redirect("/admin?error=booking_not_found");
  if (booking.status !== "pending") return redirect("/admin?error=booking_not_pending");

  try {
    // A second, overlapping pending request Owen already approved would
    // already show up here — fail loudly instead of silently double-booking
    // his real calendar. (Two visitors requesting the identical slot can't
    // reach this point at all — the DB itself refuses the second one.)
    if (await isCalendarBusy(booking.starts_at, booking.ends_at)) {
      return redirect("/admin?error=slot_conflict");
    }

    const client = booking.profiles as unknown as { email: string; full_name: string | null } | null;
    const clientLabel = client?.full_name || client?.email || "client";

    const event = await createEvent({
      summary: `Photography session — ${clientLabel}`,
      description: client?.email ? `Booked by ${clientLabel} (${client.email}) via owenmcc.photo.` : undefined,
      startISO: booking.starts_at,
      endISO: booking.ends_at,
    });

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("bookings")
      .update({ status: "confirmed", google_event_id: event.id })
      .eq("id", booking.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (updateErr) throw updateErr;

    if (updated && client?.email) {
      try {
        const { data: settings } = await supabaseAdmin.from("booking_settings").select("timezone").eq("id", 1).single();
        const { subject, html } = bookingConfirmedEmail({
          clientName: clientLabel,
          startISO: booking.starts_at,
          endISO: booking.ends_at,
          timezone: settings?.timezone ?? "America/New_York",
          portalUrl: `${new URL(request.url).origin}/portal/login`,
        });
        await sendEmail({ to: client.email, subject, html });
      } catch (err) {
        console.error("failed to email client about approved booking:", err instanceof Error ? err.message : err);
      }
    }

    return redirect("/admin?approved=1");
  } catch (err) {
    console.error("booking approve failed:", err instanceof Error ? err.message : err);
    return redirect("/admin?error=approve_failed");
  }
};
