export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { findOrCreateClient } from "../../../../lib/supabase/findOrCreateClient";
import { sendEmail } from "../../../../lib/resend";
import { contractRequestEmail } from "../../../../lib/emailTemplates";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** "2026-10-12" -> "October 12, 2026" (formatted in UTC so the server's own timezone can't shift the date). */
function formatSessionDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "16:00" -> "4:00 PM" */
function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const title = String(form.get("title") ?? "").trim();
  const clientName = String(form.get("clientName") ?? "").trim();
  const address = String(form.get("address") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  const sessionDateRaw = String(form.get("sessionDate") ?? "").trim();
  const startTimeRaw = String(form.get("startTime") ?? "").trim();
  const endTimeRaw = String(form.get("endTime") ?? "").trim();
  const location = String(form.get("location") ?? "").trim();
  const totalFee = parseFloat(String(form.get("totalFee") ?? ""));
  const bookingId = String(form.get("bookingId") ?? "").trim() || null;

  if (
    !EMAIL_RE.test(email) ||
    !title ||
    !clientName ||
    !DATE_RE.test(sessionDateRaw) ||
    (startTimeRaw && !TIME_RE.test(startTimeRaw)) ||
    (endTimeRaw && !TIME_RE.test(endTimeRaw)) ||
    !(totalFee > 0)
  ) {
    return redirect("/admin/contracts/new?error=create_failed");
  }
  if (bookingId && !UUID_RE.test(bookingId)) {
    return redirect("/admin/contracts/new?error=create_failed");
  }

  const sessionDate = formatSessionDate(sessionDateRaw);
  const startEndTime =
    startTimeRaw && endTimeRaw
      ? `${formatTime12h(startTimeRaw)} – ${formatTime12h(endTimeRaw)}`
      : startTimeRaw
        ? formatTime12h(startTimeRaw)
        : "";

  const retainer = (totalFee * 0.2).toFixed(2);
  const balance = (totalFee * 0.8).toFixed(2);

  const prefillFields = {
    clientName,
    address,
    email,
    phone,
    sessionDate,
    startEndTime,
    location,
    totalFee: totalFee.toFixed(2),
    retainer,
    balance,
  };

  try {
    const authUser = await findOrCreateClient(email);

    if (bookingId) {
      const { data: bk } = await supabaseAdmin
        .from("bookings")
        .select("id, client_id")
        .eq("id", bookingId)
        .maybeSingle();
      if (!bk || bk.client_id !== authUser.id) {
        return redirect("/admin/contracts/new?error=create_failed");
      }
    }

    const contractId = crypto.randomUUID();
    const signToken = crypto.randomUUID();
    const signingUrl = `${new URL(request.url).origin}/contracts/sign/${signToken}`;

    const { error: insertErr } = await supabaseAdmin.from("contracts").insert({
      id: contractId,
      client_id: authUser.id,
      booking_id: bookingId,
      title,
      status: "sent",
      prefill_fields: prefillFields,
      sign_token: signToken,
      signing_url: signingUrl,
    });
    if (insertErr) throw insertErr;

    try {
      const { subject, html } = contractRequestEmail({ clientName, title, signUrl: signingUrl });
      await sendEmail({ to: email, subject, html });
    } catch (err) {
      console.error("failed to email client about new contract:", err instanceof Error ? err.message : err);
    }

    return redirect("/admin?contracted=1");
  } catch (err) {
    console.error("create contract failed:", err instanceof Error ? err.message : err);
    return redirect("/admin/contracts/new?error=create_failed");
  }
};
