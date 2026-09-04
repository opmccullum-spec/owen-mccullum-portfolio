// Server-only. Small fetch wrapper for the Resend email API — same shape as
// lib/documenso.ts (plain fetch, no SDK): a single endpoint with no
// cryptographic verification step, so the official `resend` package would
// buy nothing over this.

const BASE_URL = "https://api.resend.com";

class ResendError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

async function resendFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.RESEND_API_KEY}`,
      ...init?.headers,
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ResendError(`Resend API error: ${res.status}`, res.status, body);
  }
  return body;
}

export function sendEmail(params: { to: string; subject: string; html: string }): Promise<{ id: string }> {
  return resendFetch("/emails", {
    method: "POST",
    body: JSON.stringify({
      from: import.meta.env.EMAIL_FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  });
}
