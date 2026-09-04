export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { sendEmail } from "../../../../lib/resend";
import { bookingDeclinedEmail } from "../../../../lib/emailTemplates";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const bookingId = String(form.get("bookingId") ?? "");

  // Never made it to Google Calendar, so declining is just a status flip.
  // The `.eq("status", "pending")` guard plus returning the row via
  // `.select()` means a redelivered/double-clicked decline only emails the
  // client once — a second attempt finds no matching row to update.
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .update({ status: "declined" })
    .eq("id", bookingId)
    .eq("status", "pending")
    .select("starts_at, ends_at, profiles(email, full_name)")
    .maybeSingle();

  if (error) {
    console.error("booking decline failed:", error.message);
    return redirect("/admin?error=decline_failed");
  }

  if (booking) {
    const client = booking.profiles as unknown as { email: string; full_name: string | null } | null;
    if (client?.email) {
      try {
        const { data: settings } = await supabaseAdmin.from("booking_settings").select("timezone").eq("id", 1).single();
        const { subject, html } = bookingDeclinedEmail({
          clientName: client.full_name || client.email,
          startISO: booking.starts_at,
          endISO: booking.ends_at,
          timezone: settings?.timezone ?? "America/New_York",
          bookUrl: `${new URL(request.url).origin}/book`,
        });
        await sendEmail({ to: client.email, subject, html });
      } catch (err) {
        console.error("failed to email client about declined booking:", err instanceof Error ? err.message : err);
      }
    }
  }

  return redirect("/admin?declined=1");
};
