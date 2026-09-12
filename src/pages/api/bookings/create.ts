export const prerender = false;

import type { APIRoute } from "astro";
import { formatInTimeZone } from "date-fns-tz";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import { findOrCreateClient } from "../../../lib/supabase/findOrCreateClient";
import { isCalendarBusy } from "../../../lib/googleCalendar";
import { sendEmail } from "../../../lib/resend";
import { bookingRequestOwnerEmail } from "../../../lib/emailTemplates";
import { calculatePrice, isBookingCategory, CATEGORY_LABELS } from "../../../lib/pricing";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public and unauthenticated on purpose (see api/availability.ts) — this is
// the direct replacement for tali.so's "anyone can request a slot" flow.
// Basic abuse mitigation only for v1: a honeypot field, a soft per-IP/
// per-client throttle, and the DB itself refuses a second pending request
// for a starts_at that already has one (bookings_pending_starts_at_uniq),
// which is what actually closes the two-visitors-same-slot race.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_body" }), { status: 400 });
  }

  const get = (key: string) => (typeof body === "object" && body && key in body ? String((body as any)[key]) : "");

  // Honeypot: real visitors never fill this in (it's hidden off-screen).
  // Pretend success so a bot doesn't learn to look for a different tell.
  if (get("company").trim().length > 0) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const name = get("name").trim();
  const email = get("email").trim();
  const note = get("note").trim().slice(0, 500);
  const startISO = get("startISO");

  const startDate = new Date(startISO);
  if (!name || !EMAIL_RE.test(email) || isNaN(startDate.getTime()) || startDate.getTime() < Date.now()) {
    return new Response(JSON.stringify({ ok: false, error: "invalid_input" }), { status: 400 });
  }

  // From the /book pricing calculator — optional (a request could in theory
  // arrive without it) and never trusted for the actual price: we recompute
  // that ourselves from the category/hours/date below.
  const categoryRaw = get("category");
  const hoursRaw = Number(get("hours"));
  const category = isBookingCategory(categoryRaw) ? categoryRaw : null;
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : null;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || clientAddress || null;

  try {
    const { data: settings, error: settingsErr } = await supabaseAdmin
      .from("booking_settings")
      .select("session_duration_minutes, timezone")
      .eq("id", 1)
      .single();
    if (settingsErr || !settings) throw settingsErr ?? new Error("booking_settings missing");

    // The real reservation spans the client's actual requested hours, not
    // the site-wide default — otherwise a 4-hour session would only ever
    // block 60 minutes on the calendar (and pass the free/busy check below
    // for a slot that's only free for that first hour). Falls back to the
    // default only if hours is somehow missing.
    const durationMinutes = hours ? hours * 60 : settings.session_duration_minutes;
    const endISO = new Date(startDate.getTime() + durationMinutes * 60_000).toISOString();

    // The calendar day the session actually falls on in Owen's own
    // timezone — not wherever the visitor happens to be — since that's
    // what decides whether the federal-holiday surcharge applies.
    const estimate =
      category && hours
        ? calculatePrice(category, hours, formatInTimeZone(startDate, settings.timezone, "yyyy-MM-dd"))
        : null;

    // Soft throttle: too many requests from this IP recently, regardless of
    // which email they claim — a real client asking about several dates
    // would email Owen directly rather than mash the form.
    if (ip) {
      const since = new Date(Date.now() - 60 * 60_000).toISOString();
      const { count } = await supabaseAdmin
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("requester_ip", ip)
        .gte("created_at", since);
      if ((count ?? 0) >= 3) {
        return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), { status: 429 });
      }
    }

    if (await isCalendarBusy(startISO, endISO)) {
      return new Response(JSON.stringify({ ok: false, error: "slot_taken" }), { status: 409 });
    }

    const authUser = await findOrCreateClient(email);
    await supabaseAdmin
      .from("profiles")
      .update({ full_name: name })
      .eq("id", authUser.id)
      .is("full_name", null);

    const { error: insertErr } = await supabaseAdmin.from("bookings").insert({
      client_id: authUser.id,
      starts_at: startISO,
      ends_at: endISO,
      status: "pending",
      note: note || null,
      requester_ip: ip,
      category: estimate?.category ?? null,
      hours: estimate?.hours ?? null,
      estimated_price_cents: estimate?.totalCents ?? null,
    });

    if (insertErr) {
      // Someone else's pending request landed on this exact slot first.
      if (insertErr.code === "23505") {
        return new Response(JSON.stringify({ ok: false, error: "slot_taken" }), { status: 409 });
      }
      throw insertErr;
    }

    try {
      const { subject, html } = bookingRequestOwnerEmail({
        name,
        email,
        note: note || null,
        startISO,
        endISO,
        timezone: settings.timezone,
        adminUrl: `${new URL(request.url).origin}/admin`,
        estimate: estimate
          ? {
              categoryLabel: CATEGORY_LABELS[estimate.category],
              hours: estimate.hours,
              totalCents: estimate.totalCents,
              isHoliday: estimate.isHoliday,
            }
          : null,
      });
      await sendEmail({ to: import.meta.env.OWNER_EMAIL, subject, html });
    } catch (err) {
      console.error("failed to email owner about new booking request:", err instanceof Error ? err.message : err);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("booking create failed:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ ok: false, error: "create_failed" }), { status: 500 });
  }
};
