// Shared view-model helpers for the admin "shoots" tables — the one on
// /admin (every shoot, newest-relevant first) and the one on
// /admin/clients/[id] (just that client's shoots, with per-item actions).
// Kept in one place so the two pages can't quietly drift on what counts as
// "overdue" or "owes".

export type ContractStatus = "draft" | "sent" | "signed" | "voided";
export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export interface ContractLite {
  id: string;
  title: string;
  status: ContractStatus;
  signing_url: string | null;
  signed_pdf_url: string | null;
  signed_pdf_sha256?: string | null;
  countersigned_at?: string | null;
  countersigned_pdf_url?: string | null;
  countersigned_pdf_sha256?: string | null;
}

export interface InvoiceLite {
  id: string;
  status: InvoiceStatus;
  amount_cents: number;
  hosted_invoice_url: string | null;
}

export interface BookingLite {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  client_id: string;
  profiles?: { email: string; full_name: string | null } | null;
  contracts?: ContractLite[];
  invoices?: InvoiceLite[];
}

export const DAY_MS = 86_400_000;

export const isOpenInvoice = (s: InvoiceStatus) => s !== "paid" && s !== "void";

export function money(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function isPastShoot(startsAt: string, now = Date.now()) {
  return new Date(startsAt).getTime() < now;
}

export function daysSinceShoot(startsAt: string, now = Date.now()) {
  return Math.max(1, Math.floor((now - new Date(startsAt).getTime()) / DAY_MS));
}

/**
 * Per-contract display, used on the client detail page where each contract
 * gets its own row and action buttons. A contract can only be cancelled
 * (never edited) while it's still `sent` and unsigned — once signed, it's a
 * legally executed document; once voided, there's nothing left to act on.
 */
export function contractDisplay(c: ContractLite, isPast: boolean, days: number) {
  if (c.status === "signed") {
    // The client has signed; the agreement isn't fully executed until Owen
    // countersigns too.
    if (!c.countersigned_at) {
      return { label: "Signed by client — needs your signature", canCancel: false, overdue: false, needsCountersign: true };
    }
    return { label: "Fully signed", canCancel: false, overdue: false, needsCountersign: false };
  }
  if (c.status === "voided") return { label: "Cancelled", canCancel: false, overdue: false, needsCountersign: false };
  // Only remaining status once sent is "sent" itself (draft never reaches the UI).
  if (isPast) {
    return { label: `Overdue by ${days} day${days === 1 ? "" : "s"}`, canCancel: true, overdue: true, needsCountersign: false };
  }
  return { label: "Awaiting signature", canCancel: true, overdue: false, needsCountersign: false };
}

/** The most complete version of a contract to open: fully signed copy, else client-signed copy, else the signing link. */
export function contractViewHref(c: ContractLite): string | null {
  return c.countersigned_pdf_url || c.signed_pdf_url || c.signing_url || null;
}

export function countersignHref(contractId: string): string {
  return `/admin/contracts/${contractId}/countersign`;
}

/**
 * Per-invoice display. An invoice can be cancelled or edited (edit = void +
 * recreate, since Stripe won't let the total change once it's live) only
 * while `sent` and unpaid — once paid, the amount is locked in for good.
 */
export function invoiceDisplay(i: InvoiceLite) {
  if (i.status === "paid") return { label: "Paid", canAct: false };
  if (i.status === "void") return { label: "Cancelled", canAct: false };
  return { label: `Owes ${money(i.amount_cents)}`, canAct: true };
}

export interface ShootRow {
  id: string;
  status: string;
  clientId: string;
  start: Date;
  startMs: number;
  isPast: boolean;
  clientName: string;
  email: string;
  contract: ContractLite | null;
  contractState: "none" | "signed" | "countersign" | "due" | "overdue";
  contractOverdueDays: number;
  contractHref: string | null;
  owedCents: number;
  paidCents: number;
  payHref: string | null;
  paymentState: "none" | "paid" | "owes";
  contractSort: number;
  paymentSort: number;
}

/** Aggregate, one-row-per-shoot view-model for the main /admin table. */
export function buildShootRow(b: BookingLite, now = Date.now()): ShootRow {
  const start = new Date(b.starts_at);
  const startMs = start.getTime();
  const isPast = isPastShoot(b.starts_at, now);
  const days = daysSinceShoot(b.starts_at, now);

  const contract = (b.contracts ?? [])[0] ?? null;
  let contractState: ShootRow["contractState"] = "none";
  let contractOverdueDays = 0;
  if (contract) {
    if (contract.status === "signed") contractState = contract.countersigned_at ? "signed" : "countersign";
    else if (contract.status === "voided") contractState = "none";
    else if (isPast) {
      contractState = "overdue";
      contractOverdueDays = days;
    } else contractState = "due";
  }
  const contractHref: string | null = contract ? contractViewHref(contract) : null;

  const invoicesForShoot = b.invoices ?? [];
  const owedCents = invoicesForShoot
    .filter((i) => isOpenInvoice(i.status))
    .reduce((sum, i) => sum + (i.amount_cents ?? 0), 0);
  const paidCents = invoicesForShoot
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + (i.amount_cents ?? 0), 0);
  const payHref = invoicesForShoot.find((i) => isOpenInvoice(i.status))?.hosted_invoice_url ?? null;
  const paymentState: ShootRow["paymentState"] = !invoicesForShoot.length ? "none" : owedCents > 0 ? "owes" : "paid";

  const contractSort =
    contractState === "overdue"
      ? -contractOverdueDays
      : contractState === "countersign"
        ? 0
        : contractState === "due"
          ? 1_000_000
          : contractState === "signed"
            ? 2_000_000
            : 3_000_000;
  const paymentSort = paymentState === "owes" ? -owedCents : paymentState === "paid" ? 1 : 2;

  return {
    id: b.id,
    status: b.status,
    clientId: b.client_id,
    start,
    startMs,
    isPast,
    clientName: b.profiles?.full_name || b.profiles?.email || "—",
    email: b.profiles?.email || "—",
    contract,
    contractState,
    contractOverdueDays,
    contractHref,
    owedCents,
    paidCents,
    payHref,
    paymentState,
    contractSort,
    paymentSort,
  };
}
