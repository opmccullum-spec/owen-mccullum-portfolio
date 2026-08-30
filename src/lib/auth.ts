import type { AstroGlobal } from "astro";
import { createSupabaseServerClient } from "./supabase/server";
import type { Profile } from "./supabase/types";

type AuthedContext = {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  user: NonNullable<
    Awaited<ReturnType<ReturnType<typeof createSupabaseServerClient>["auth"]["getUser"]>>["data"]["user"]
  >;
  profile: Profile;
};

/**
 * Guard for any page under /portal. Redirects to /portal/login if there's
 * no logged-in user. Use at the very top of a page's frontmatter:
 *
 *   const auth = await requireUser(Astro);
 *   if (auth instanceof Response) return auth;
 *   const { user, profile } = auth;
 */
export async function requireUser(Astro: AstroGlobal): Promise<AuthedContext | Response> {
  const supabase = createSupabaseServerClient(Astro.request, Astro.cookies);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Astro.redirect("/portal/login");
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  if (!profile) {
    // Signed in with Supabase Auth but the profiles row hasn't been created
    // yet (the DB trigger that creates it may not have run, or the schema
    // migration hasn't been applied) — treat as not-fully-logged-in.
    return Astro.redirect("/portal/login?error=missing_profile");
  }

  return { supabase, user, profile };
}

/**
 * Guard for /admin pages. Same as requireUser, but also checks
 * profiles.is_admin and bounces non-admins back to their own portal.
 */
export async function requireAdmin(Astro: AstroGlobal): Promise<AuthedContext | Response> {
  const auth = await requireUser(Astro);
  if (auth instanceof Response) return auth;

  if (!auth.profile.is_admin) {
    return Astro.redirect("/portal");
  }

  return auth;
}
