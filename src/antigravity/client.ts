import { getValidAccessToken } from "../oauth";
import type { AntigravityEnvelope, Env } from "../types";

export const ANTIGRAVITY_ENDPOINTS = [
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
] as const;

export const ANTIGRAVITY_IDE_UA =
  "antigravity/ide/2.5.5 (os_type=windows; arch=amd64; aidev_client; auth_method=oauth)";
export const ANTIGRAVITY_CLI_UA =
  "antigravity/cli/1.3.4 (os_type=darwin; arch=arm64; aidev_client; auth_method=oauth)";

/**
 * Select the appropriate Antigravity User-Agent header for the target wire model.
 * Note: `gemini-4-argon*` models require the CLI User-Agent, while other agent models
 * (`gemini-3.8-flash*`, `gemini-3.7-flash*`, `claude-*`) use the IDE User-Agent.
 */
export function getUserAgentForModel(wireModelId: string, env?: Env): string {
  if (/^gemini-4-argon/i.test(wireModelId)) {
    return ANTIGRAVITY_CLI_UA;
  }
  if (env?.ANTIGRAVITY_USER_AGENT?.trim()) {
    return env.ANTIGRAVITY_USER_AGENT.trim();
  }
  return ANTIGRAVITY_IDE_UA;
}

/**
 * Build the mandatory HTTP headers for Antigravity / Cloud Code Assist v1internal calls.
 */
export function buildAntigravityHeaders(options: {
  accessToken: string;
  projectId?: string;
  wireModelId: string;
  stream: boolean;
  env?: Env;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": getUserAgentForModel(options.wireModelId, options.env),
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    }),
  };

  if (options.stream) {
    headers["Accept"] = "text/event-stream";
  } else {
    headers["Accept"] = "application/json";
  }

  return headers;
}

/**
 * Dispatch a unary or streaming generation request to the Antigravity v1internal API.
 * Features:
 * - Automatic access_token retrieval & refresh via KV
 * - Automatic retry with forced token refresh on 401 Unauthorized
 * - Multi-endpoint fallback across Daily Sandbox and Production Cloud Code Assist gateways
 */
export async function sendAntigravityRequest(
  env: Env,
  envelope: AntigravityEnvelope,
  stream: boolean,
): Promise<Response> {
  let tokenInfo = await getValidAccessToken(env, false);

  const fallbackProjectId = env.DEFAULT_PROJECT_ID || "rising-fact-p41fc";
  // Avoid "aicode-consumers" placeholder project which lacks serviceUsageConsumer permission
  const rawProjectId = envelope.project || tokenInfo.projectId || fallbackProjectId;
  const primaryProjectId =
    rawProjectId === "aicode-consumers" ? fallbackProjectId : rawProjectId;

  const projectCandidates = Array.from(
    new Set([primaryProjectId, fallbackProjectId])
  );

  const actionPath = stream
    ? "/v1internal:streamGenerateContent?alt=sse"
    : "/v1internal:generateContent";

  let lastResponse: Response | null = null;
  let hasRetried401 = false;

  for (const activeProjectId of projectCandidates) {
    const payload: AntigravityEnvelope = {
      ...envelope,
      project: activeProjectId,
    };
    const bodyStr = JSON.stringify(payload);

    for (let i = 0; i < ANTIGRAVITY_ENDPOINTS.length; i++) {
      const baseUrl = ANTIGRAVITY_ENDPOINTS[i]!;
      const url = `${baseUrl}${actionPath}`;

      const headers = buildAntigravityHeaders({
        accessToken: tokenInfo.accessToken,
        projectId: activeProjectId,
        wireModelId: payload.model,
        stream,
        env,
      });

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: bodyStr,
      });

      if (response.ok) {
        return response;
      }

      // If 401 Unauthorized, force-refresh token once and retry the same endpoint
      if (response.status === 401 && !hasRetried401) {
        hasRetried401 = true;
        tokenInfo = await getValidAccessToken(env, true);
        i--; // Retry current endpoint index with new token
        continue;
      }

      lastResponse = response;

      // If 403, 404, or 5xx transient error, try next endpoint / project candidate
      if (
        response.status === 403 ||
        response.status === 404 ||
        response.status >= 500
      ) {
        continue;
      }

      // For 400 (bad request) or 429 (rate limit), return immediately
      return response;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw new Error("Gagal menghubungi seluruh endpoint Antigravity Cloud Code Assist.");
}

/**
 * Optionally fetch live available models from Antigravity's `:fetchAvailableModels` endpoint.
 */
export async function fetchDiscoveredAntigravityModels(env: Env): Promise<string[]> {
  try {
    const tokenInfo = await getValidAccessToken(env, false);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${tokenInfo.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": ANTIGRAVITY_CLI_UA,
    };

    for (const baseUrl of ANTIGRAVITY_ENDPOINTS) {
      const res = await fetch(`${baseUrl}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers,
        body: JSON.stringify({ project: tokenInfo.projectId }),
      });

      if (res.ok) {
        const data = (await res.json().catch(() => null)) as {
          models?: Record<string, unknown>;
        } | null;
        if (data?.models && typeof data.models === "object") {
          return Object.keys(data.models);
        }
      }
    }
  } catch {
    // Non-fatal: caller falls back to static SUPPORTED_MODELS list
  }
  return [];
}
