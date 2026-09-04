// Server-only. Small fetch wrapper for the Google Calendar v3 API — same
// shape as lib/documenso.ts (plain fetch, no SDK), chosen over the official
// `googleapis` package to keep the serverless function bundle small; that
// package pulls in every Google API's types even when only Calendar is used.
//
// Auth: a long-lived OAuth refresh token (obtained once via
// scripts/get-google-refresh-token.mjs) is exchanged here for a short-lived
// access token, cached in memory for the life of the serverless instance.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const BASE_URL = "https://www.googleapis.com/calendar/v3";

function calendarId(): string {
  return import.meta.env.GOOGLE_CALENDAR_ID || "primary";
}

class GoogleCalendarError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: import.meta.env.GOOGLE_CLIENT_ID,
      client_secret: import.meta.env.GOOGLE_CLIENT_SECRET,
      refresh_token: import.meta.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new GoogleCalendarError(`Google token refresh failed: ${res.status}`, res.status, body);
  }

  // Refresh a minute early so a slow-running request never straddles expiry.
  cachedToken = {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in - 60) * 1000,
  };
  return cachedToken.accessToken;
}

async function calendarFetch(path: string, init?: RequestInit): Promise<unknown> {
  const accessToken = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  });

  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new GoogleCalendarError(`Google Calendar API error: ${res.status}`, res.status, body);
  }
  return body;
}

export type BusyInterval = { start: string; end: string };

/**
 * Owen's busy time from his real calendar over [timeMinISO, timeMaxISO).
 * This is the source of truth availability is computed against — it also
 * naturally reflects any booking we've already approved, since approving
 * one is what creates the real event in the first place.
 */
export async function getFreeBusy(timeMinISO: string, timeMaxISO: string): Promise<BusyInterval[]> {
  const id = calendarId();
  const body = (await calendarFetch("/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id }] }),
  })) as { calendars?: Record<string, { busy?: BusyInterval[] }> };

  return body.calendars?.[id]?.busy ?? [];
}

/**
 * Narrow last-second check used right before writing a pending request or
 * approving one — freeBusy only ever returns blocks that overlap the
 * queried window, so any result at all means the window isn't free.
 */
export async function isCalendarBusy(startISO: string, endISO: string): Promise<boolean> {
  const busy = await getFreeBusy(startISO, endISO);
  return busy.length > 0;
}

export async function createEvent(params: {
  summary: string;
  description?: string;
  startISO: string;
  endISO: string;
}): Promise<{ id: string }> {
  const body = (await calendarFetch(`/calendars/${encodeURIComponent(calendarId())}/events`, {
    method: "POST",
    body: JSON.stringify({
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.startISO },
      end: { dateTime: params.endISO },
    }),
  })) as { id: string };
  return body;
}

/** Tolerates the event already being gone (404/410) — treated as success. */
export async function deleteEvent(eventId: string): Promise<void> {
  try {
    await calendarFetch(`/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
  } catch (err) {
    if (err instanceof GoogleCalendarError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}
