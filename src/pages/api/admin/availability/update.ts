export const prerender = false;

import type { APIRoute } from "astro";
import { requireAdminApi } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import type { DayKey, WorkingHours } from "../../../../lib/supabase/types";

const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const auth = await requireAdminApi(request, cookies);
  if (auth instanceof Response) return auth;

  const form = await request.formData();

  const num = (key: string) => Number(form.get(key));
  const sessionDurationMinutes = num("session_duration_minutes");
  const bufferMinutes = num("buffer_minutes");
  const slotIntervalMinutes = num("slot_interval_minutes");
  const advanceBookingDays = num("advance_booking_days");
  const minNoticeHours = num("min_notice_hours");
  const timezone = String(form.get("timezone") ?? "").trim();

  if (
    !Number.isFinite(sessionDurationMinutes) ||
    sessionDurationMinutes <= 0 ||
    !Number.isFinite(bufferMinutes) ||
    bufferMinutes < 0 ||
    !Number.isFinite(slotIntervalMinutes) ||
    slotIntervalMinutes <= 0 ||
    !Number.isFinite(advanceBookingDays) ||
    advanceBookingDays <= 0 ||
    !Number.isFinite(minNoticeHours) ||
    minNoticeHours < 0 ||
    !timezone
  ) {
    return redirect("/admin/availability?error=update_failed");
  }

  const workingHours: WorkingHours = {};
  for (const day of DAY_KEYS) {
    if (form.get(`available_${day}`) !== "on") {
      workingHours[day] = null;
      continue;
    }
    const start = String(form.get(`start_${day}`) ?? "");
    const end = String(form.get(`end_${day}`) ?? "");
    if (!start || !end || start >= end) {
      return redirect("/admin/availability?error=update_failed");
    }
    workingHours[day] = { start, end };
  }

  const { error } = await supabaseAdmin
    .from("booking_settings")
    .update({
      session_duration_minutes: sessionDurationMinutes,
      buffer_minutes: bufferMinutes,
      slot_interval_minutes: slotIntervalMinutes,
      advance_booking_days: advanceBookingDays,
      min_notice_hours: minNoticeHours,
      timezone,
      working_hours: workingHours,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    console.error("availability settings update failed:", error.message);
    return redirect("/admin/availability?error=update_failed");
  }

  return redirect("/admin/availability?saved=1");
};
