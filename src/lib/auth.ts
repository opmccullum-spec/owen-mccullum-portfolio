import type { AstroCookies, AstroGlobal } from "astro";
import { createSupabaseServerClient } from "./supabase/server";
import type { Profile } from "./supabase/types";

type AuthedContext = {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  user: NonNullable<
    Awaited<ReturnType<ReturnType<typeof createSupabaseServerClient>["auth"]["getUser"]>>["data"]["user"]
  >;
  profile: Profile;
};

type AuthResult =
  | { status: "ok"; ctx: AuthedContext }
  | { status: "no_user" }
  | { status: "no_profile" };

/**
 * Core check, no redirect behavior: who (if anyone) is logged in, with their
 * profiles row. Shared by the .astro page guards below and by API-route
 * guards, which need different failure behavior (redirect vs JSON response).
 */
async function getAuthedProfile(request: Request, cookies: AstroCookies): Promise<AuthResult> {
  const supabase = createSupabaseServerClient(request, cookies);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { status: "no_user" };

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) return { status: "no_profile" };

  return { status: "ok", ctx: { supabase, user, profile } };
}

/**
 * Guard for any page under /portal. Redirects to /portal/login if there's
 * no logged-in user. Use at the very top of a page's frontmatter:
 *
 *   const auth = await requireUser(Astro);
 *   if (auth instanceof Response) return auth;
 *   const { user, profile } = auth;
 */
export async function requireUser(Astro: AstroGlobal): Promise<AuthedContext | Response> {
  const result = await getAuthedProfile(Astro.request, Astro.cookies);
  if (result.status === "no_user") return Astro.redirect("/portal/login");
  if (result.status === "no_profile") return Astro.redirect("/portal/login?error=missing_profile");
  return result.ctx;
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

/**
 * Guard for plain API routes (src/pages/api/**) — these have no page to
 * redirect "back" to, so failures are a JSON 401/403 response instead.
 */
export async function requireAdminApi(request: Request, cookies: AstroCookies): Promise<AuthedContext | Response> {
  const result = await getAuthedProfile(request, cookies);
  if (result.status !== "ok") {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }
  if (!result.ctx.profile.is_admin) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403 });
  }
  return result.ctx;
}
