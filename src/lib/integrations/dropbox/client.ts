// Server-only. The ONLY place an authenticated Dropbox client is
// instantiated — never imported from a "use client" component. Callers
// pass an already-decrypted refresh token (see service.ts, which decrypts
// immediately before use and never exports the plaintext further).
import { Dropbox } from "dropbox";
import type { DropboxEnvConfig } from "./constants";

// Passing refreshToken + clientId + clientSecret lets the SDK's own
// DropboxAuth transparently request a fresh short-lived access token per
// request as needed — no manual refresh-token bookkeeping or cached access
// token is stored by this application (see DropboxIntegration's schema
// comment: "Prefer obtaining access tokens from the refresh token when
// needed").
export function createDropboxClient(env: DropboxEnvConfig, refreshToken: string): Dropbox {
  return new Dropbox({
    clientId: env.appKey,
    clientSecret: env.appSecret,
    refreshToken,
  });
}
