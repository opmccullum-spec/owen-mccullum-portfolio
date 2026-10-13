// Server-side half of Cloudflare Turnstile: the browser gets a one-time token
// from the widget, and this confirms with Cloudflare that it's genuine.
// Until TURNSTILE_SECRET_KEY is set the check is skipped, so the forms keep
// working while the keys are being set up — protection switches on the moment
// the key exists.
export async function verifyTurnstile(token: unknown, ip: string | null): Promise<boolean> {
  const secret = import.meta.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (typeof token !== "string" || !token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("turnstile verification request failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
