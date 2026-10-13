// Browser-side half of Cloudflare Turnstile. Renders the widget into a given
// element and hands back the one-time token on request. With no site key
// configured it's a no-op that returns a null token (the server skips its
// check in that case too).
const SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileHandle = {
  getToken: () => Promise<string | null>;
  reset: () => void;
};

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error("Turnstile script failed to load"));
      };
      document.head.append(s);
    });
  }
  return scriptPromise;
}

export function mountTurnstile(container: HTMLElement): TurnstileHandle {
  if (!SITE_KEY) return { getToken: async () => null, reset() {} };

  let token: string | null = null;
  let widgetId: string | undefined;
  const waiting: Array<(t: string | null) => void> = [];

  loadScript()
    .then(() => {
      widgetId = window.turnstile!.render(container, {
        sitekey: SITE_KEY,
        callback: (t) => {
          token = t;
          waiting.splice(0).forEach((resolve) => resolve(t));
        },
        "expired-callback": () => {
          token = null;
        },
        "error-callback": () => {
          token = null;
        },
      });
    })
    .catch(() => {
      // Script blocked (ad blocker, offline) — the token stays null and the
      // server will reject the submission with a clear message.
    });

  return {
    getToken() {
      if (token) return Promise.resolve(token);
      return new Promise((resolve) => {
        waiting.push(resolve);
        // Don't hang forever if the check never completes.
        setTimeout(() => resolve(token), 10_000);
      });
    },
    reset() {
      token = null;
      if (widgetId !== undefined) window.turnstile?.reset(widgetId);
    },
  };
}
