// Server-side pages render on Vercel, whose clock is UTC — so formatting a
// session time with the server's own locale shows e.g. 7:00 PM for a 3:00 PM
// Eastern session. Everything that shows a session time on the server should
// format it in the business timezone from Owen's availability settings.
import { formatInTimeZone } from "date-fns-tz";
import { supabaseAdmin } from "./supabase/admin";

export const DEFAULT_BUSINESS_TZ = "America/New_York";

export async function getBusinessTimezone(): Promise<string> {
  const { data } = await supabaseAdmin.from("booking_settings").select("timezone").eq("id", 1).maybeSingle();
  return data?.timezone || DEFAULT_BUSINESS_TZ;
}

export function inTz(date: Date | string, tz: string, pattern: string): string {
  return formatInTimeZone(typeof date === "string" ? new Date(date) : date, tz, pattern);
}
