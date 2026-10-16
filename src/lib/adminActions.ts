// Works out the "needed actions" message board on /admin: what Owen has to do
// next, derived entirely from the current state of bookings, contracts and
// invoices (so a finished step simply stops showing up — nothing to dismiss).
//
// Owen's process:
//   1. Approve or decline a new booking request.
//   2. Once booked: send the retainer invoice and the contract.
//   3. Nothing until the client signs — then countersign.
//   4. After the session date passes: send the photos by the date in the
//      contract (7 days after the session unless the client wrote a different
//      timeline on the signing page), then mark them sent.
//   Once the photos are marked sent, no reminder.

import { CATEGORY_LABELS, type BookingCategory } from "./pricing";
import { money } from "./adminShoots";

export const BUSINESS_TZ_FALLBACK = "America/New_York";
export const DEFAULT_DELIVERY_DAYS = 7;

export interface ActionButton {
  label: string;
  href?: string;
  /** A POST button: an existing admin endpoint plus its hidden fields. */
  post?: { action: string; fields: Record<string, string> };
  confirm?: string;
}

export interface ActionItem {
  id: string;
  /** Lower sorts first. */
  urgency: number;
  /** Tie-breaker within an urgency group (e.g. a date). */
  sub: number;
  tone: "normal" | "overdue";
  title: string;
  detail: string;
  buttons: ActionButton[];
}

// ── date helpers (all calendar-day math is done on plain YYYY-MM-DD strings
// in the business timezone, so it can't drift with the server's own zone) ──

function ymdIn(date: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDaysYMD(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function addBusinessDaysYMD(ymd: string, n: number): string {
  let cur = ymd;
  let left = n;
  while (left > 0) {
    cur = addDaysYMD(cur, 1);
    const dow = new Date(`${cur}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return cur;
}

export function formatYMD(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * When the photos are due. The contract promises delivery within 7 days of
 * the session unless the client wrote a different timeline on the signing
 * page ("days / date"). That's free text, so understand the common shapes
 * ("3 days", "2 weeks", "5 business days", "Nov 3") and otherwise fall back
 * to the 7-day default — the caller still shows the client's exact words.
 */
export function photosDueYMD(sessionYMD: string, timeline?: string | null): { dueYMD: string; custom: string | null } {
  const text = (timeline ?? "").trim();
  if (text) {
    const business = /(\d+)\s*business\s*days?/i.exec(text);
    if (business) return { dueYMD: addBusinessDaysYMD(sessionYMD, Number(business[1])), custom: text };
    const days = /(\d+)\s*days?/i.exec(text);
    if (days) return { dueYMD: addDaysYMD(sessionYMD, Number(days[1])), custom: text };
    const weeks = /(\d+)\s*weeks?/i.exec(text);
    if (weeks) return { dueYMD: addDaysYMD(sessionYMD, 7 * Number(weeks[1])), custom: text };

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      const sessionYear = Number(sessionYMD.slice(0, 4));
      let year = parsed.getFullYear();
      // "Nov 3" with no year parses as 2001 — use the session's year instead.
      if (year < 2020) year = sessionYear;
      const pad = (n: number) => String(n).padStart(2, "0");
      let ymd = `${year}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
      if (ymd < sessionYMD) ymd = `${year + 1}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
      return { dueYMD: ymd, custom: text };
    }
  }
  return { dueYMD: addDaysYMD(sessionYMD, DEFAULT_DELIVERY_DAYS), custom: text || null };
}

function whenLabel(iso: string, tz: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

const clientNameOf = (p: { full_name?: string | null; email?: string | null } | null | undefined) =>
  p?.full_name || p?.email || "A client";

export function buildAdminActions(params: {
  /** bookings with profiles(email, full_name), contracts(*), invoices(id, status) */
  bookings: any[];
  /** contracts the client has signed that Owen hasn't countersigned yet (any booking, or none) */
  needsCountersign: any[];
  tz: string;
  now?: number;
}): ActionItem[] {
  const now = params.now ?? Date.now();
  const tz = params.tz;
  const todayYMD = ymdIn(new Date(now), tz);
  const items: ActionItem[] = [];

  for (const b of params.bookings) {
    const startMs = new Date(b.starts_at).getTime();
    const endMs = new Date(b.ends_at).getTime();
    const isPast = endMs < now;
    const name = clientNameOf(b.profiles);
    const email: string = b.profiles?.email ?? "";
    const label = CATEGORY_LABELS[b.category as BookingCategory] ?? "session";
    const when = whenLabel(b.starts_at, tz);

    if (b.status === "pending") {
      const bits = [
        b.hours ? `${b.hours} hour${b.hours === 1 ? "" : "s"}` : null,
        b.estimated_price_cents != null ? `estimate ${money(b.estimated_price_cents)}` : null,
      ].filter(Boolean);
      items.push({
        id: `decide-${b.id}`,
        urgency: 1,
        sub: startMs,
        tone: "normal",
        title: `${name} requested a ${label.toLowerCase()} session — ${when}`,
        detail: ["Approve or decline this booking request", ...bits].join(" · "),
        buttons: [
          { label: "Approve", post: { action: "/api/admin/bookings/approve", fields: { bookingId: b.id } } },
          { label: "Decline", post: { action: "/api/admin/bookings/decline", fields: { bookingId: b.id } } },
        ],
      });
      continue;
    }

    if (b.status !== "confirmed") continue;

    const activeInvoices = (b.invoices ?? []).filter((i: any) => i.status !== "void");
    const activeContracts = (b.contracts ?? []).filter((c: any) => c.status !== "voided");

    if (!isPast) {
      const q = `bookingId=${encodeURIComponent(b.id)}&email=${encodeURIComponent(email)}&clientName=${encodeURIComponent(name)}`;
      if (!activeInvoices.length) {
        items.push({
          id: `invoice-${b.id}`,
          urgency: 3,
          sub: startMs,
          tone: "normal",
          title: `Send ${name} the retainer invoice — ${when}`,
          detail: "This session is booked. The retainer invoice hasn't been sent yet.",
          buttons: [{ label: "Send invoice", href: `/admin/invoices/new?${q}` }],
        });
      }
      if (!activeContracts.length) {
        items.push({
          id: `contract-${b.id}`,
          urgency: 3,
          sub: startMs + 1,
          tone: "normal",
          title: `Send ${name} the contract — ${when}`,
          detail: "This session is booked. The contract hasn't been sent yet.",
          buttons: [{ label: "Send contract", href: `/admin/contracts/new?${q}` }],
        });
      }
    }

    if (isPast && !b.photos_sent_at) {
      const sessionYMD = ymdIn(new Date(b.starts_at), tz);
      const contract =
        activeContracts.find((c: any) => c.status === "signed") ?? activeContracts.find((c: any) => c.status === "sent");
      const timeline = (contract?.client_fields as { deliveryTimeline?: string } | null)?.deliveryTimeline;
      const { dueYMD, custom } = photosDueYMD(sessionYMD, timeline);
      const overdue = todayYMD > dueYMD;
      items.push({
        id: `photos-${b.id}`,
        urgency: overdue ? 0 : 4,
        sub: new Date(`${dueYMD}T00:00:00Z`).getTime(),
        tone: overdue ? "overdue" : "normal",
        title: `Send ${name} their photos — due ${formatYMD(dueYMD)}${overdue ? " (overdue)" : ""}`,
        detail: `Session was ${formatYMD(sessionYMD)}. ${
          custom ? `The contract says: “${custom}”.` : `Standard delivery: within ${DEFAULT_DELIVERY_DAYS} days of the session.`
        }`,
        buttons: [
          {
            label: "Mark photos sent",
            post: { action: "/api/admin/bookings/photos-sent", fields: { bookingId: b.id } },
            confirm: "Mark these photos as sent? The reminder will disappear.",
          },
        ],
      });
    }
  }

  for (const c of params.needsCountersign) {
    const name = clientNameOf(c.profiles);
    items.push({
      id: `countersign-${c.id}`,
      urgency: 2,
      sub: c.signed_at ? new Date(c.signed_at).getTime() : 0,
      tone: "normal",
      title: `${name} signed “${c.title}” — it needs your signature`,
      detail: "Review their signed copy and countersign to finish the agreement.",
      buttons: [{ label: "Countersign", href: `/admin/contracts/${c.id}/countersign` }],
    });
  }

  return items.sort((a, b) => a.urgency - b.urgency || a.sub - b.sub);
}
