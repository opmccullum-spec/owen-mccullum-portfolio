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
 * Validate a `next` redirect target: must be a same-site relative path, so a
 * crafted `?next=` can never bounce a login through to an external site.
 * Anything else (absolute URL, protocol-relative `//host`, empty) is
 * rejected in favor of the caller's own default.
 */
export function safeRedirectPath(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  return path;
}

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
  // Preserve where they were headed (e.g. /admin) so logging in from here
  // lands them back there instead of always dropping them at /portal.
  const next = encodeURIComponent(Astro.url.pathname + Astro.url.search);
  if (result.status === "no_user") return Astro.redirect(`/portal/login?next=${next}`);
  if (result.status === "no_profile") return Astro.redirect(`/portal/login?error=missing_profile&next=${next}`);
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

/**
 * Same shape as requireAdminApi but for any logged-in client, not just
 * admins — e.g. a client cancelling their own booking. First non-admin API
 * guard in the codebase; every other API route so far has been /api/admin/**.
 */
export async function requireUserApi(request: Request, cookies: AstroCookies): Promise<AuthedContext | Response> {
  const result = await getAuthedProfile(request, cookies);
  if (result.status !== "ok") {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }
  return result.ctx;
}

/**
 * For pages that work whether or not someone's logged in (e.g. the public
 * /book page) — returns the session if there is one, null otherwise, never
 * a redirect or error response.
 */
export async function getOptionalProfile(request: Request, cookies: AstroCookies): Promise<AuthedContext | null> {
  const result = await getAuthedProfile(request, cookies);
  return result.status === "ok" ? result.ctx : null;
}
