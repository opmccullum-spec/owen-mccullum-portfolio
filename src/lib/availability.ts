// Pure slot-generation logic — no network or database calls, so it's easy
// to reason about (and unit-test later) separately from the Google
// Calendar / Supabase I/O that feeds it.
//
// Timezone note: Owen's working hours are wall-clock times in his own
// timezone (e.g. "9am" in America/New_York), but everything is stored/
// compared as UTC instants, and the UTC offset for a given wall-clock time
// shifts twice a year across DST. `date-fns-tz` handles this correctly —
// `toZonedTime` lets us read a UTC instant's calendar date/weekday AS SEEN
// in Owen's timezone, and `fromZonedTime` converts a wall-clock time on a
// specific date back to the correct UTC instant for that date.

import { addDays, addMinutes } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export type WorkingHours = Partial<Record<DayKey, { start: string; end: string } | null>>;

export type BusyInterval = { start: string; end: string };
export type Slot = { start: Date; end: Date };

export function computeAvailableSlots(params: {
  workingHours: WorkingHours;
  timezone: string;
  sessionDurationMinutes: number;
  bufferMinutes: number;
  advanceBookingDays: number;
  minNoticeHours: number;
  busyIntervals: BusyInterval[];
  now?: Date;
}): Slot[] {
  const {
    workingHours,
    timezone,
    sessionDurationMinutes,
    bufferMinutes,
    advanceBookingDays,
    minNoticeHours,
    busyIntervals,
    now = new Date(),
  } = params;

  const earliestStart = addMinutes(now, minNoticeHours * 60);

  // Give existing calendar events (not just our own generated slots) the
  // same breathing room on both sides.
  const expandedBusy = busyIntervals.map((b) => ({
    start: addMinutes(new Date(b.start), -bufferMinutes),
    end: addMinutes(new Date(b.end), bufferMinutes),
  }));

  const slots: Slot[] = [];
  const localNow = toZonedTime(now, timezone);

  for (let dayOffset = 0; dayOffset <= advanceBookingDays; dayOffset++) {
    const localDay = addDays(localNow, dayOffset);
    const dayKey = DAY_KEYS[localDay.getDay()];
    const hours = workingHours[dayKey];
    if (!hours) continue;

    const dateStr = [
      localDay.getFullYear(),
      String(localDay.getMonth() + 1).padStart(2, "0"),
      String(localDay.getDate()).padStart(2, "0"),
    ].join("-");

    const windowStart = fromZonedTime(`${dateStr}T${hours.start}:00`, timezone);
    const windowEnd = fromZonedTime(`${dateStr}T${hours.end}:00`, timezone);

    let cursor = windowStart;
    while (true) {
      const slotEnd = addMinutes(cursor, sessionDurationMinutes);
      if (slotEnd > windowEnd) break;

      const overlapsBusy = expandedBusy.some((b) => cursor < b.end && slotEnd > b.start);
      if (!overlapsBusy && cursor >= earliestStart) {
        slots.push({ start: cursor, end: slotEnd });
      }

      cursor = addMinutes(cursor, sessionDurationMinutes + bufferMinutes);
    }
  }

  return slots;
}
