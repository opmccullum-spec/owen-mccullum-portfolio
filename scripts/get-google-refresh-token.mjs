// Run this ONCE, locally, after creating a Google OAuth Client ID (see the
// setup steps in the chat / plan doc). It is NOT part of the deployed app —
// this exchange only ever needs to happen a single time.
//
// Usage:
//   node --env-file=.env scripts/get-google-refresh-token.mjs
//
// Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to already be in your
// .env file. When creating the OAuth Client ID in Google Cloud Console, add
// this EXACT redirect URI to "Authorized redirect URIs":
//
//   http://localhost:53682/oauth2callback
//
// This script will print a URL — open it, sign in with the Google account
// whose calendar you want to use, and approve access. You'll land on a
// plain "you can close this tab" page, and the refresh token will be
// printed in this terminal — paste that into .env (and into Vercel) as
// GOOGLE_REFRESH_TOKEN.

import http from "node:http";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = "https://www.googleapis.com/auth/calendar";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in your .env file. Add those first.");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent"); // forces a refresh_token even on repeat runs

console.log("\nOpen this URL in your browser and approve access:\n");
console.log(authUrl.toString());
console.log("\nWaiting for you to finish signing in...\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end(`Google reported an error: ${error}`);
    console.error("Google reported an error:", error);
    server.close();
    process.exit(1);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const tokenBody = await tokenRes.json();

    if (!tokenRes.ok || !tokenBody.refresh_token) {
      res
        .writeHead(500, { "Content-Type": "text/plain" })
        .end("Token exchange failed — check the terminal for details.");
      console.error("Token exchange failed:", tokenBody);
      server.close();
      process.exit(1);
    }

    res
      .writeHead(200, { "Content-Type": "text/plain" })
      .end("Success — you can close this tab and go back to the terminal.");

    console.log("Success! Your refresh token is:\n");
    console.log(tokenBody.refresh_token);
    console.log("\nAdd this to .env (and to Vercel's environment variables) as GOOGLE_REFRESH_TOKEN.\n");
  } finally {
    server.close();
  }
});

server.listen(PORT);
