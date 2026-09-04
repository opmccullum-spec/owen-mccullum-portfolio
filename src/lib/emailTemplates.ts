// Pure string-building for every email this app sends — kept separate from
// the API routes that trigger them, same split as lib/availability.ts (pure
// logic) vs. api/availability.ts (the I/O that feeds it).

import { formatInTimeZone } from "date-fns-tz";

/**
 * A client's own timezone isn't knowable server-side, so every email states
 * Owen's timezone explicitly (e.g. "9:00 AM EDT") rather than leaving it
 * ambiguous — `formatInTimeZone` reads the real offset for that instant
 * (DST-correct), the same library already used for slot generation.
 */
export function formatSessionTime(startISO: string, endISO: string, timezone: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const datePart = formatInTimeZone(start, timezone, "EEEE, MMMM d");
  const startPart = formatInTimeZone(start, timezone, "h:mm a");
  const endPart = formatInTimeZone(end, timezone, "h:mm a zzz");
  return `${datePart} · ${startPart}–${endPart}`;
}

export function wrapEmail(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px; line-height: 1.5;">
    <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin: 0 0 20px;">
      Owen McCullum Photography
    </p>
    ${bodyHtml}
  </body>
</html>`;
}

export function bookingRequestOwnerEmail(params: {
  name: string;
  email: string;
  note: string | null;
  startISO: string;
  endISO: string;
  timezone: string;
  adminUrl: string;
}) {
  const when = formatSessionTime(params.startISO, params.endISO, params.timezone);
  return {
    subject: `New booking request — ${params.name}`,
    html: wrapEmail(`
      <p>${params.name} (${params.email}) requested a session:</p>
      <p><strong>${when}</strong></p>
      ${params.note ? `<p>Note: ${params.note}</p>` : ""}
      <p><a href="${params.adminUrl}">Review it in your admin dashboard →</a></p>
    `),
  };
}

export function bookingConfirmedEmail(params: {
  clientName: string;
  startISO: string;
  endISO: string;
  timezone: string;
  portalUrl: string;
}) {
  const when = formatSessionTime(params.startISO, params.endISO, params.timezone);
  return {
    subject: "Your session is confirmed",
    html: wrapEmail(`
      <p>Hi ${params.clientName},</p>
      <p>Your session is confirmed for:</p>
      <p><strong>${when}</strong></p>
      <p>Looking forward to it! You can manage this booking anytime at the <a href="${params.portalUrl}">client portal</a>.</p>
    `),
  };
}

export function bookingDeclinedEmail(params: {
  clientName: string;
  startISO: string;
  endISO: string;
  timezone: string;
  bookUrl: string;
}) {
  const when = formatSessionTime(params.startISO, params.endISO, params.timezone);
  return {
    subject: "Update on your session request",
    html: wrapEmail(`
      <p>Hi ${params.clientName},</p>
      <p>Unfortunately Owen isn't available for your requested time:</p>
      <p><strong>${when}</strong></p>
      <p>Feel free to <a href="${params.bookUrl}">request another time</a>.</p>
    `),
  };
}

export function bookingCancelledByAdminEmail(params: {
  clientName: string;
  startISO: string;
  endISO: string;
  timezone: string;
}) {
  const when = formatSessionTime(params.startISO, params.endISO, params.timezone);
  return {
    subject: "Your session has been cancelled",
    html: wrapEmail(`
      <p>Hi ${params.clientName},</p>
      <p>Your session on <strong>${when}</strong> has been cancelled.</p>
      <p>If you have questions, just reply to this email.</p>
    `),
  };
}

export function bookingCancelledByClientOwnerEmail(params: {
  clientName: string;
  clientEmail: string;
  startISO: string;
  endISO: string;
  timezone: string;
}) {
  const when = formatSessionTime(params.startISO, params.endISO, params.timezone);
  return {
    subject: `Booking cancelled — ${params.clientName}`,
    html: wrapEmail(`
      <p>${params.clientName} (${params.clientEmail}) cancelled their session:</p>
      <p><strong>${when}</strong></p>
    `),
  };
}

export function invoicePaidOwnerEmail(params: { clientName: string; description: string; amountCents: number }) {
  const amount = (params.amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return {
    subject: `Invoice paid — ${amount} from ${params.clientName}`,
    html: wrapEmail(`
      <p>${params.clientName} just paid an invoice:</p>
      <p><strong>${params.description}</strong> — ${amount}</p>
    `),
  };
}

export function contractSignedOwnerEmail(params: { clientName: string; title: string }) {
  return {
    subject: `Contract signed — ${params.title}`,
    html: wrapEmail(`
      <p>${params.clientName} just signed:</p>
      <p><strong>${params.title}</strong></p>
    `),
  };
}
