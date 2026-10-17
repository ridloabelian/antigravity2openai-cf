import {
  DEFAULT_FALLBACK_PROJECT_ID,
  getTokenState,
  saveTokenState,
  updateAccessTokenInKV,
} from "./kv";
import type { AntigravityTokenState, Env } from "./types";

/**
 * Known Google Antigravity / Cloud Code Assist OAuth 2.0 Client Credentials
 */
export const ANTIGRAVITY_CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
export const ANTIGRAVITY_CLIENT_SECRET =
  "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";

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

export const DEFAULT_REDIRECT_URI = "http://localhost:8085";

/**
 * Required OAuth scopes for Google Antigravity / Cloud Code Assist
 */
export const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
  "openid",
];

/**
 * Refresh token 5 minutes (300,000 ms) before actual expiry
 */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Real Antigravity IDE User-Agent used during project discovery & onboarding
 */
export const ANTIGRAVITY_IDE_USER_AGENT =
  "antigravity/ide/2.5.5 (os_type=windows; arch=amd64; aidev_client; auth_method=oauth)";

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Generate the Google OAuth 2.0 authorization URL for Antigravity login.
 */
export function generateAuthUrl(env?: Env, redirectUri = DEFAULT_REDIRECT_URI): string {
  const clientId = env?.GOOGLE_CLIENT_ID || ANTIGRAVITY_CLIENT_ID;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: ANTIGRAVITY_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Extract the authorization `code` (and any custom `redirect_uri`) from user input.
 * Supports:
 * 1. Full callback URL: `http://localhost:8085/?code=4/0A...&scope=...`
 * 2. Query string fragment: `?code=4/0A...&scope=...` or `code=4/0A...`
 * 3. Raw authorization code: `4/0A...`
 * 4. Direct refresh token: `1//0g...`
 */
export function parseOAuthInput(rawInput: string): {
  code: string;
  redirectUri: string;
  isRefreshToken: boolean;
} {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error("Input tidak boleh kosong. Silakan tempel Redirect URL atau Authorization Code.");
  }

  // Case 1: Full HTTP/HTTPS URL pasted from browser address bar
  if (/^https?:\/\//i.test(trimmed)) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      throw new Error("Format URL yang ditempel tidak valid.");
    }

    const errorParam = parsedUrl.searchParams.get("error");
    if (errorParam) {
      throw new Error(`Google OAuth mengembalikan error: ${errorParam}`);
    }

    const code = parsedUrl.searchParams.get("code");
    if (!code) {
      throw new Error("Parameter `code` tidak ditemukan di dalam URL yang ditempel.");
    }

    // Determine redirect_uri: if localhost:8085 with root path, match DEFAULT_REDIRECT_URI
    let redirectUri = DEFAULT_REDIRECT_URI;
    const isDefaultHost =
      (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1") &&
      parsedUrl.port === "8085" &&
      (parsedUrl.pathname === "/" || parsedUrl.pathname === "");

    if (!isDefaultHost) {
      redirectUri =
        parsedUrl.pathname === "/" && !trimmed.includes("8085/?")
          ? parsedUrl.origin
          : `${parsedUrl.origin}${parsedUrl.pathname === "/" ? "" : parsedUrl.pathname}`;
    }

    return {
      code: code.trim(),
      redirectUri,
      isRefreshToken: false,
    };
  }

  // Case 2: Query parameters pasted directly (e.g. `code=4/0A...&scope=...`)
  if (trimmed.includes("code=")) {
    const search = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
    const params = new URLSearchParams(search);
    const code = params.get("code");
    if (code) {
      return {
        code: code.trim(),
        redirectUri: DEFAULT_REDIRECT_URI,
        isRefreshToken: false,
      };
    }
  }

  // Case 3: Direct Google OAuth refresh_token (starts with `1//`)
  if (trimmed.startsWith("1//")) {
    return {
      code: trimmed,
      redirectUri: DEFAULT_REDIRECT_URI,
      isRefreshToken: true,
    };
  }

  // Case 4: Raw authorization code (e.g. `4/0A...`)
  return {
    code: decodeURIComponent(trimmed),
    redirectUri: DEFAULT_REDIRECT_URI,
    isRefreshToken: false,
  };
}

/**
 * Decode JWT payload (e.g., id_token) without external dependencies to extract user email.
 */
function decodeJwtPayload(jwt?: string): Record<string, unknown> | null {
  if (!jwt) return null;
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const base64Url = parts[1]!;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const jsonText = new TextDecoder().decode(bytes);
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Fetch user email from id_token or Google UserInfo endpoint.
 */
export async function fetchUserEmail(accessToken: string, idToken?: string): Promise<string | undefined> {
  const jwtPayload = decodeJwtPayload(idToken);
  if (jwtPayload && typeof jwtPayload.email === "string" && jwtPayload.email.length > 0) {
    return jwtPayload.email.toLowerCase();
  }

  try {
    const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { email?: string };
      if (typeof data.email === "string" && data.email.length > 0) {
        return data.email.toLowerCase();
      }
    }
  } catch {
    // Non-fatal if userinfo fails
  }
  return undefined;
}

/**
 * Extract project ID from loadCodeAssist / onboardUser response object.
 */
function extractProjectIdFromResponse(data: Record<string, unknown> | null | undefined): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  for (const key of ["cloudaicompanionProject", "projectId", "project"]) {
    const val = data[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
    if (val && typeof val === "object" && typeof (val as { id?: unknown }).id === "string") {
      return (val as { id: string }).id.trim();
    }
  }
  return undefined;
}

/**
 * Automatically discover (or onboard) the Google Cloud Project ID linked to the Antigravity session.
 */
export async function discoverAntigravityProject(accessToken: string, env?: Env): Promise<string> {
  const endpoints = [
    "https://cloudcode-pa.googleapis.com",
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    "https://daily-cloudcode-pa.googleapis.com",
  ];

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": env?.ANTIGRAVITY_USER_AGENT || ANTIGRAVITY_IDE_USER_AGENT,
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    }),
  };

  // Step 1: Try `v1internal:loadCodeAssist` across endpoints
  for (const baseUrl of endpoints) {
    try {
      const res = await fetch(`${baseUrl}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: "ANTIGRAVITY",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      });

      if (res.ok) {
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        const discovered = extractProjectIdFromResponse(data);
        if (discovered) {
          return discovered;
        }
      }
    } catch {
      // Try next endpoint
    }
  }

  // Step 2: Try onboarding via `v1internal:onboardUser` if account has no companion project yet
  for (const baseUrl of [
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    "https://daily-cloudcode-pa.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ]) {
    try {
      const res = await fetch(`${baseUrl}/v1internal:onboardUser`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          tier_id: "free-tier",
          metadata: {
            ide_type: "ANTIGRAVITY",
            ide_name: "antigravity",
            ide_version: "2.5.5",
          },
        }),
      });

      if (res.ok) {
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (data?.done === true && data.response && typeof data.response === "object") {
          const discovered = extractProjectIdFromResponse(data.response as Record<string, unknown>);
          if (discovered) {
            return discovered;
          }
        }
      }
    } catch {
      // Ignore and fall back
    }
  }

  return env?.DEFAULT_PROJECT_ID || DEFAULT_FALLBACK_PROJECT_ID;
}

/**
 * Exchange an OAuth authorization code (or pasted redirect URL / refresh token) for tokens,
 * discover the project ID and email, and persist everything in Cloudflare KV.
 */
export async function exchangeCodeAndSave(
  env: Env,
  rawInput: string,
  customProjectId?: string,
): Promise<AntigravityTokenState> {
  const { code, redirectUri, isRefreshToken } = parseOAuthInput(rawInput);
  const clientId = env.GOOGLE_CLIENT_ID || ANTIGRAVITY_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET || ANTIGRAVITY_CLIENT_SECRET;

  let tokenData: GoogleTokenResponse;

  if (isRefreshToken) {
    // User pasted a `1//...` refresh_token directly
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: code,
        grant_type: "refresh_token",
      }).toString(),
    });

    tokenData = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
    if (!res.ok || !tokenData.access_token) {
      throw new Error(
        `Gagal menukar refresh_token (${res.status}): ${tokenData.error_description || tokenData.error || "Unknown error"}`,
      );
    }
    tokenData.refresh_token = code;
  } else {
    // Standard authorization_code exchange
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    tokenData = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
    if (!res.ok || !tokenData.access_token) {
      throw new Error(
        `Gagal menukar authorization code (${res.status}): ${tokenData.error_description || tokenData.error || "Pastikan code belum kedaluwarsa dan hanya digunakan satu kali."}`,
      );
    }
  }

  // Fallback to existing refresh_token in KV if Google didn't issue a new one
  const existingState = await getTokenState(env).catch(() => null);
  const refreshToken = tokenData.refresh_token || existingState?.refresh_token;
  if (!refreshToken) {
    throw new Error(
      "Google OAuth tidak mengembalikan `refresh_token`. Silakan klik tombol '1. Open Google OAuth Login' lagi (yang menyertakan prompt=consent & access_type=offline) lalu tempel URL baru.",
    );
  }

  const expiresInSec =
    typeof tokenData.expires_in === "number" && Number.isFinite(tokenData.expires_in)
      ? tokenData.expires_in
      : 3600;
  const expiresAtMs = Date.now() + expiresInSec * 1000;

  // Discover email & Cloud Code Assist project ID in parallel
  const [userEmail, discoveredProjectId] = await Promise.all([
    fetchUserEmail(tokenData.access_token, tokenData.id_token),
    customProjectId && customProjectId.trim().length > 0
      ? Promise.resolve(customProjectId.trim())
      : discoverAntigravityProject(tokenData.access_token, env),
  ]);

  const newState: AntigravityTokenState = {
    refresh_token: refreshToken,
    access_token: tokenData.access_token,
    access_token_expires_at: expiresAtMs,
    project_id: discoveredProjectId || existingState?.project_id || env.DEFAULT_PROJECT_ID || DEFAULT_FALLBACK_PROJECT_ID,
    user_email: userEmail || existingState?.user_email,
    updated_at: new Date().toISOString(),
  };

  await saveTokenState(env, newState);
  return newState;
}

/**
 * Refresh the access_token using the stored refresh_token in KV.
 */
export async function refreshAccessToken(
  env: Env,
  currentState: AntigravityTokenState,
): Promise<AntigravityTokenState> {
  const clientId = env.GOOGLE_CLIENT_ID || ANTIGRAVITY_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET || ANTIGRAVITY_CLIENT_SECRET;

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: currentState.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });

  const tokenData = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok || !tokenData.access_token) {
    throw new Error(
      `Gagal me-refresh access token dari Google (${res.status}): ${tokenData.error_description || tokenData.error || "Refresh token mungkin telah dicabut. Silakan login ulang di /setup."}`,
    );
  }

  const expiresInSec =
    typeof tokenData.expires_in === "number" && Number.isFinite(tokenData.expires_in)
      ? tokenData.expires_in
      : 3600;
  const expiresAtMs = Date.now() + expiresInSec * 1000;

  // If project_id is missing or still using fallback, try discovering it once on refresh
  let projectId = currentState.project_id;
  if (!projectId || projectId === DEFAULT_FALLBACK_PROJECT_ID) {
    projectId = await discoverAntigravityProject(tokenData.access_token, env).catch(
      () => currentState.project_id || DEFAULT_FALLBACK_PROJECT_ID,
    );
  }

  // If user_email is missing, try discovering it
  let userEmail = currentState.user_email;
  if (!userEmail) {
    userEmail = await fetchUserEmail(tokenData.access_token, tokenData.id_token).catch(() => undefined);
  }

  return updateAccessTokenInKV(
    env,
    {
      ...currentState,
      refresh_token: tokenData.refresh_token || currentState.refresh_token,
    },
    tokenData.access_token,
    expiresAtMs,
    projectId,
    userEmail,
  );
}

/**
 * Auto-Refresh Engine:
 * Checks `ANTIGRAVITY_KV` for a cached `access_token`.
 * If missing or expiring in < 5 minutes, automatically calls Google's token refresh endpoint
 * using `refresh_token`, stores the new `access_token` and timestamp back to KV, and returns it.
 */
export async function getValidAccessToken(
  env: Env,
  forceRefresh = false,
): Promise<{
  accessToken: string;
  projectId: string;
  userEmail?: string;
  expiresAt: number;
}> {
  const state = await getTokenState(env);
  if (!state || !state.refresh_token) {
    throw new Error(
      "Antigravity OAuth belum dikonfigurasi. Silakan buka halaman `/setup` di browser untuk menghubungkan akun Google Antigravity Anda.",
    );
  }

  const now = Date.now();
  const isExpiredOrExpiringSoon =
    !state.access_token ||
    !state.access_token_expires_at ||
    state.access_token_expires_at - now < TOKEN_EXPIRY_BUFFER_MS;

  if (forceRefresh || isExpiredOrExpiringSoon) {
    const refreshed = await refreshAccessToken(env, state);
    return {
      accessToken: refreshed.access_token,
      projectId: refreshed.project_id,
      userEmail: refreshed.user_email,
      expiresAt: refreshed.access_token_expires_at,
    };
  }

  return {
    accessToken: state.access_token,
    projectId: state.project_id || env.DEFAULT_PROJECT_ID || DEFAULT_FALLBACK_PROJECT_ID,
    userEmail: state.user_email,
    expiresAt: state.access_token_expires_at,
  };
}
