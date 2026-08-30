// Hand-written types matching supabase/schema.sql. There's no Supabase CLI
// codegen step in this project (that needs an authenticated `supabase login`,
// which only Owen can do) — keep this file in sync by hand when the schema
// changes.

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  is_admin: boolean;
  created_at: string;
};

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export type Invoice = {
  id: string;
  client_id: string;
  stripe_invoice_id: string | null;
  description: string;
  amount_cents: number;
  status: InvoiceStatus;
  due_date: string | null;
  created_at: string;
};

export type ContractStatus = "draft" | "sent" | "signed" | "voided";

export type Contract = {
  id: string;
  client_id: string;
  documenso_document_id: string | null;
  title: string;
  status: ContractStatus;
  signed_pdf_url: string | null;
  created_at: string;
};

export type BookingStatus = "pending" | "confirmed" | "cancelled";

export type Booking = {
  id: string;
  client_id: string;
  google_event_id: string | null;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      invoices: { Row: Invoice; Insert: Partial<Invoice>; Update: Partial<Invoice> };
      contracts: { Row: Contract; Insert: Partial<Contract>; Update: Partial<Contract> };
      bookings: { Row: Booking; Insert: Partial<Booking>; Update: Partial<Booking> };
    };
  };
};
