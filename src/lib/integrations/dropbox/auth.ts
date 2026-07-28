// Server-only. OAuth 2 Authorization Code flow with offline access — never
// the implicit/token flow, and never the manually-generated access token
// from the Dropbox developer console.
import { DropboxAuth } from "dropbox";
import { DROPBOX_SCOPES, type DropboxEnvConfig } from "./constants";
import { DropboxIntegrationError } from "./errors";

export type ExchangedToken = {
  refreshToken: string;
  accessToken: string;
  accountId: string | null;
};

export async function buildAuthorizationUrl(env: DropboxEnvConfig, state: string): Promise<string> {
  const auth = new DropboxAuth({ clientId: env.appKey, clientSecret: env.appSecret });
  const url = await auth.getAuthenticationUrl(
    env.redirectUri,
    state,
    "code",
    "offline",
    [...DROPBOX_SCOPES],
    "none",
    false
  );
  return url;
}

// Exchanges the authorization code server-side using App Key + App Secret +
// the exact configured redirect URI. Never logs the response body (may
// contain the access/refresh token) — see errors.ts/service.ts for the only
// safe fields extracted from it.
export async function exchangeCodeForToken(env: DropboxEnvConfig, code: string): Promise<ExchangedToken> {
  const auth = new DropboxAuth({ clientId: env.appKey, clientSecret: env.appSecret });

  let result: { refresh_token?: string; access_token?: string; account_id?: string };
  try {
    const response = await auth.getAccessTokenFromCode(env.redirectUri, code);
    result = response.result as typeof result;
  } catch {
    throw new DropboxIntegrationError("TOKEN_EXCHANGE_FAILED", "Failed to exchange the Dropbox authorization code.");
  }

  if (!result.refresh_token) {
    throw new DropboxIntegrationError(
      "REFRESH_TOKEN_MISSING",
      "Dropbox did not return a refresh token. Ensure offline access was requested."
    );
  }
  if (!result.access_token) {
    throw new DropboxIntegrationError("TOKEN_EXCHANGE_FAILED", "Dropbox did not return an access token.");
  }

  return {
    refreshToken: result.refresh_token,
    accessToken: result.access_token,
    accountId: result.account_id ?? null,
  };
}
