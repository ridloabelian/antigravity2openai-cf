import type { AntigravityTokenState, Env } from "./types";

const KV_KEYS = {
  AUTH_STATE: "auth_state",
  REFRESH_TOKEN: "refresh_token",
  ACCESS_TOKEN: "access_token",
  ACCESS_TOKEN_EXPIRES_AT: "access_token_expires_at",
  PROJECT_ID: "project_id",
  USER_EMAIL: "user_email",
} as const;

export const DEFAULT_FALLBACK_PROJECT_ID = "rising-fact-p41fc";

/**
 * Retrieve the full Antigravity token & project state from Cloudflare KV.
 * Supports both the combined `auth_state` JSON record and individual KV keys
 * (`refresh_token`, `access_token`, `access_token_expires_at`, `project_id`).
 */
export async function getTokenState(env: Env): Promise<AntigravityTokenState | null> {
  if (!env.ANTIGRAVITY_KV) {
    throw new Error("KV namespace binding `ANTIGRAVITY_KV` is not configured in wrangler.toml.");
  }

  // Try fast single-key JSON read first
  const rawState = await env.ANTIGRAVITY_KV.get(KV_KEYS.AUTH_STATE);
  if (rawState) {
    try {
      const parsed = JSON.parse(rawState) as AntigravityTokenState;
      if (parsed && typeof parsed.refresh_token === "string" && parsed.refresh_token.length > 0) {
        return {
          ...parsed,
          project_id: parsed.project_id || env.DEFAULT_PROJECT_ID || DEFAULT_FALLBACK_PROJECT_ID,
        };
      }
    } catch {
      // Fall through to individual keys
    }
  }

  // Fallback: read individual keys from KV
  const [refreshToken, accessToken, expiresAtStr, projectId, userEmail] = await Promise.all([
    env.ANTIGRAVITY_KV.get(KV_KEYS.REFRESH_TOKEN),
    env.ANTIGRAVITY_KV.get(KV_KEYS.ACCESS_TOKEN),
    env.ANTIGRAVITY_KV.get(KV_KEYS.ACCESS_TOKEN_EXPIRES_AT),
    env.ANTIGRAVITY_KV.get(KV_KEYS.PROJECT_ID),
    env.ANTIGRAVITY_KV.get(KV_KEYS.USER_EMAIL),
  ]);

  if (!refreshToken) {
    return null;
  }

  const expiresAt = expiresAtStr ? Number(expiresAtStr) : 0;

  return {
    refresh_token: refreshToken,
    access_token: accessToken || "",
    access_token_expires_at: Number.isFinite(expiresAt) ? expiresAt : 0,
    project_id: projectId || env.DEFAULT_PROJECT_ID || DEFAULT_FALLBACK_PROJECT_ID,
    user_email: userEmail || undefined,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Save the Antigravity OAuth tokens and project metadata to Cloudflare KV.
 * Writes both individual keys (as required by the spec) and a unified `auth_state` JSON key.
 */
export async function saveTokenState(env: Env, state: AntigravityTokenState): Promise<void> {
  if (!env.ANTIGRAVITY_KV) {
    throw new Error("KV namespace binding `ANTIGRAVITY_KV` is not configured in wrangler.toml.");
  }

  const normalized: AntigravityTokenState = {
    refresh_token: state.refresh_token,
    access_token: state.access_token,
    access_token_expires_at: state.access_token_expires_at,
    project_id: state.project_id || env.DEFAULT_PROJECT_ID || DEFAULT_FALLBACK_PROJECT_ID,
    user_email: state.user_email,
    updated_at: new Date().toISOString(),
  };

  const writes: Promise<void>[] = [
    env.ANTIGRAVITY_KV.put(KV_KEYS.AUTH_STATE, JSON.stringify(normalized)),
    env.ANTIGRAVITY_KV.put(KV_KEYS.REFRESH_TOKEN, normalized.refresh_token),
    env.ANTIGRAVITY_KV.put(KV_KEYS.ACCESS_TOKEN, normalized.access_token),
    env.ANTIGRAVITY_KV.put(KV_KEYS.ACCESS_TOKEN_EXPIRES_AT, String(normalized.access_token_expires_at)),
    env.ANTIGRAVITY_KV.put(KV_KEYS.PROJECT_ID, normalized.project_id),
  ];

  if (normalized.user_email) {
    writes.push(env.ANTIGRAVITY_KV.put(KV_KEYS.USER_EMAIL, normalized.user_email));
  }

  await Promise.all(writes);
}

/**
 * Update only the cached access_token and expiration timestamp in KV (plus optional project_id).
 */
export async function updateAccessTokenInKV(
  env: Env,
  currentState: AntigravityTokenState,
  accessToken: string,
  expiresAtMs: number,
  projectId?: string,
  userEmail?: string,
): Promise<AntigravityTokenState> {
  const updated: AntigravityTokenState = {
    ...currentState,
    access_token: accessToken,
    access_token_expires_at: expiresAtMs,
    project_id: projectId || currentState.project_id || env.DEFAULT_PROJECT_ID || DEFAULT_FALLBACK_PROJECT_ID,
    user_email: userEmail || currentState.user_email,
    updated_at: new Date().toISOString(),
  };

  await saveTokenState(env, updated);
  return updated;
}

/**
 * Clear all stored OAuth tokens and metadata from Cloudflare KV.
 */
export async function clearTokenState(env: Env): Promise<void> {
  if (!env.ANTIGRAVITY_KV) return;
  await Promise.all([
    env.ANTIGRAVITY_KV.delete(KV_KEYS.AUTH_STATE),
    env.ANTIGRAVITY_KV.delete(KV_KEYS.REFRESH_TOKEN),
    env.ANTIGRAVITY_KV.delete(KV_KEYS.ACCESS_TOKEN),
    env.ANTIGRAVITY_KV.delete(KV_KEYS.ACCESS_TOKEN_EXPIRES_AT),
    env.ANTIGRAVITY_KV.delete(KV_KEYS.PROJECT_ID),
    env.ANTIGRAVITY_KV.delete(KV_KEYS.USER_EMAIL),
  ]);
}
