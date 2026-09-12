export const prerender = false;

import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../lib/supabase/admin";
import { getFreeBusy } from "../../lib/googleCalendar";
import { computeAvailableSlots } from "../../lib/availability";
import { MIN_HOURS, MAX_HOURS } from "../../lib/pricing";

// Public and unauthenticated on purpose — it only ever returns open time
// slots (no client data), same as the tali.so widget it replaces exposed to
// any visitor. The date window is always server-computed from Owen's own
// settings, never taken from the caller, so nobody can force an oversized
// free/busy query.
//
// Pending requests older than this stop counting as "busy" so a flood of
// spam requests can't permanently make the calendar look fully booked even
// if nobody checks /admin for a few days — they stay visible there
// indefinitely either way, this only affects what's shown as available.
const PENDING_HOLD_HOURS = 48;

export const GET: APIRoute = async ({ url }) => {
  // The client's chosen shoot length — a slot must have this much
  // contiguous free time, not just the site-wide default, so a 4-hour
  // session is never offered a start time that's only actually free for
  // the first hour of it. Falls back to the site-wide default (below) if
  // missing or out of range, e.g. a request that skips the calculator.
  const hoursParam = Number(url.searchParams.get("hours"));
  const hours = Number.isFinite(hoursParam) ? Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.round(hoursParam))) : null;

  const { data: settings, error: settingsErr } = await supabaseAdmin
    .from("booking_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (settingsErr || !settings) {
    console.error("failed to load booking_settings:", settingsErr);
    return new Response(JSON.stringify({ ok: false, error: "not_configured" }), { status: 500 });
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + settings.advance_booking_days * 24 * 60 * 60 * 1000);

  try {
    const busyFromCalendar = await getFreeBusy(now.toISOString(), windowEnd.toISOString());

    const holdSince = new Date(now.getTime() - PENDING_HOLD_HOURS * 60 * 60 * 1000).toISOString();
    const { data: pending, error: pendingErr } = await supabaseAdmin
      .from("bookings")
      .select("starts_at, ends_at")
      .eq("status", "pending")
      .gte("created_at", holdSince)
      .lt("starts_at", windowEnd.toISOString());
    if (pendingErr) throw pendingErr;

    const busyIntervals = [
      ...busyFromCalendar,
      ...(pending ?? []).map((b) => ({ start: b.starts_at, end: b.ends_at })),
    ];

    const slots = computeAvailableSlots({
      workingHours: settings.working_hours,
      timezone: settings.timezone,
      sessionDurationMinutes: hours ? hours * 60 : settings.session_duration_minutes,
      bufferMinutes: settings.buffer_minutes,
      slotIntervalMinutes: settings.slot_interval_minutes,
      advanceBookingDays: settings.advance_booking_days,
      minNoticeHours: settings.min_notice_hours,
      busyIntervals,
      now,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        slots: slots.map((s) => ({ startISO: s.start.toISOString(), endISO: s.end.toISOString() })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("failed to compute availability:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ ok: false, error: "unavailable" }), { status: 500 });
  }
};
