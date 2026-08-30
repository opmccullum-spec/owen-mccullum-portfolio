import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Privileged Supabase client using the SERVICE ROLE key — it bypasses Row
 * Level Security entirely.
 *
 * SERVER-ONLY. Never import this file from a component or script that
 * ships to the browser. Use it only inside /api routes and admin-only
 * server code (e.g. sending an invoice, marking a contract signed).
 */
export const supabaseAdmin = createClient<Database>(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
