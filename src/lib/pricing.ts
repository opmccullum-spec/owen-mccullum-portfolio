/**
 * Session pricing — shared between the client-side calculator on /book and
 * the server-side price stored on the booking row, so both always agree.
 * Pure date-math, no I/O: every function here operates on plain
 * year/month/day components (or a "YYYY-MM-DD" string) rather than a real
 * `Date` instant, so there's no UTC-vs-local timezone drift between running
 * in the browser and running on the (UTC) server.
 */

export type BookingCategory = "family" | "events" | "proposals" | "portraits";

export const CATEGORY_LABELS: Record<BookingCategory, string> = {
  family: "Family",
  events: "Events",
  proposals: "Proposals",
  portraits: "Portraits & Headshots",
};

// First-hour rate, in cents.
const FIRST_HOUR_RATE_CENTS: Record<BookingCategory, number> = {
  family: 20000,
  events: 30000,
  proposals: 25000,
  portraits: 15000,
};

const ADDITIONAL_HOUR_DISCOUNT = 0.2; // each hour after the first is 20% off the first hour's rate
const HOLIDAY_SURCHARGE = 0.2; // +20% on the total when the shoot falls on a federal holiday

export const MIN_HOURS = 1;
export const MAX_HOURS = 10;

export function isBookingCategory(value: unknown): value is BookingCategory {
  return typeof value === "string" && value in FIRST_HOUR_RATE_CENTS;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): [number, number, number] {
  const d = new Date(year, month, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === weekday) {
      count++;
      if (count === n) return [year, month, d.getDate()];
    }
    d.setDate(d.getDate() + 1);
  }
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): [number, number, number] {
  const d = new Date(year, month + 1, 0); // last calendar day of the month
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
  return [year, month, d.getDate()];
}

/**
 * The 11 US federal holidays for a given year. Fixed-date holidays use the
 * literal calendar date (e.g. July 4th is always the 4th) rather than the
 * government's Friday/Monday "observed" shift when it lands on a weekend —
 * that's a federal-office-closure quirk, not how most people think about
 * "it's the 4th of July."
 */
function federalHolidaysForYear(year: number): Array<[number, number, number]> {
  return [
    [year, 0, 1], // New Year's Day
    nthWeekdayOfMonth(year, 0, 1, 3), // Martin Luther King Jr.'s Birthday
    nthWeekdayOfMonth(year, 1, 1, 3), // Washington's Birthday
    lastWeekdayOfMonth(year, 4, 1), // Memorial Day
    [year, 5, 19], // Juneteenth
    [year, 6, 4], // Independence Day
    nthWeekdayOfMonth(year, 8, 1, 1), // Labor Day
    nthWeekdayOfMonth(year, 9, 1, 2), // Columbus Day
    [year, 10, 11], // Veterans Day
    nthWeekdayOfMonth(year, 10, 4, 4), // Thanksgiving Day
    [year, 11, 25], // Christmas Day
  ];
}

/** Parses a plain "YYYY-MM-DD" string (as produced by <input type="date">) into components. */
export function parseISODateOnly(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

export function isFederalHoliday(dateOnly: string): boolean {
  const parsed = parseISODateOnly(dateOnly);
  if (!parsed) return false;
  const holidays = federalHolidaysForYear(parsed.year);
  return holidays.some(([y, mo, d]) => y === parsed.year && mo === parsed.month && d === parsed.day);
}

export interface PriceBreakdown {
  category: BookingCategory;
  hours: number;
  baseCents: number;
  isHoliday: boolean;
  holidaySurchargeCents: number;
  totalCents: number;
}

/** `dateOnly` is a plain "YYYY-MM-DD" string — see the module doc for why. */
export function calculatePrice(category: BookingCategory, hours: number, dateOnly: string): PriceBreakdown {
  const clampedHours = Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.round(hours)));
  const firstHour = FIRST_HOUR_RATE_CENTS[category];
  const additionalHourRate = Math.round(firstHour * (1 - ADDITIONAL_HOUR_DISCOUNT));
  const baseCents = firstHour + (clampedHours - 1) * additionalHourRate;
  const holiday = isFederalHoliday(dateOnly);
  const totalCents = holiday ? Math.round(baseCents * (1 + HOLIDAY_SURCHARGE)) : baseCents;
  return {
    category,
    hours: clampedHours,
    baseCents,
    isHoliday: holiday,
    holidaySurchargeCents: totalCents - baseCents,
    totalCents,
  };
}
