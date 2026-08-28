import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import type { Database } from "./types";

/**
 * Per-request Supabase client for use in .astro pages and /api routes.
 * Bound to the ANON key, so every query is subject to Row Level Security —
 * this is the client that represents "whoever is logged in right now"
 * (or nobody, if there's no session).
 *
 * Never use this for privileged admin operations — see admin.ts for that.
 */
export function createSupabaseServerClient(request: Request, cookies: AstroCookies) {
  return createServerClient<Database>(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get("Cookie") ?? "");
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookies.set(name, value, options);
          });
        },
      },
    },
  );
}
