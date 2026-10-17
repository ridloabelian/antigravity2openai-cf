import {
  fetchDiscoveredAntigravityModels,
  sendAntigravityRequest,
} from "./antigravity/client";
import { buildOpenAIModelsList } from "./converters/models";
import { convertOpenAIToAntigravityRequest } from "./converters/request";
import {
  convertAntigravityToOpenAIResponse,
  createOpenAIStreamTransformer,
} from "./converters/response";
import { getTokenState } from "./kv";
import { getValidAccessToken } from "./oauth";
import {
  AntigravityResponsePayload,
  Env,
  OpenAIChatCompletionRequest,
} from "./types";
import { handleSetupRequest } from "./ui/setup";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-API-Key, X-Admin-Password, OpenAI-Beta, x-goog-api-key",
  "Access-Control-Max-Age": "86400",
};

/**
 * Helper to return a JSON response with CORS headers attached.
 */
function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

/**
 * Helper to return an OpenAI-formatted error response.
 */
function openAIErrorResponse(
  message: string,
  status = 400,
  type = "invalid_request_error",
  code: string | null = null
): Response {
  return jsonResponse(
    {
      error: {
        message,
        type,
        param: null,
        code,
      },
    },
    status
  );
}

/**
 * Constant-time string comparison for API key validation.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/**
 * Validate client `Authorization: Bearer <API_KEY>` or `x-api-key` header.
 * If `env.API_KEY` is not configured, requests are allowed through.
 */
function verifyClientApiKey(request: Request, env: Env): boolean {
  const expectedKey = env.API_KEY?.trim();
  if (!expectedKey) {
    return true;
  }

  let providedKey = "";
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    providedKey = authHeader.slice(7).trim();
  } else {
    providedKey =
      request.headers.get("x-api-key")?.trim() ||
      request.headers.get("x-goog-api-key")?.trim() ||
      "";
  }

  if (!providedKey) {
    return false;
  }

  return timingSafeEqual(providedKey, expectedKey);
}

/**
 * Handle `GET /v1/models`
 */
async function handleModelsRequest(
  request: Request,
  env: Env
): Promise<Response> {
  if (!verifyClientApiKey(request, env)) {
    return openAIErrorResponse(
      "Invalid or missing API key. Provide Authorization: Bearer <API_KEY>.",
      401,
      "authentication_error",
      "invalid_api_key"
    );
  }

  const url = new URL(request.url);
  const fetchLive = url.searchParams.get("live") === "true";

  let discoveredIds: string[] = [];
  if (fetchLive) {
    discoveredIds = await fetchDiscoveredAntigravityModels(env);
  }

  const modelsList = buildOpenAIModelsList(discoveredIds);
  return jsonResponse(modelsList, 200);
}

/**
 * Handle `POST /v1/chat/completions`
 */
async function handleChatCompletionsRequest(
  request: Request,
  env: Env
): Promise<Response> {
  if (!verifyClientApiKey(request, env)) {
    return openAIErrorResponse(
      "Invalid or missing API key. Provide Authorization: Bearer <API_KEY>.",
      401,
      "authentication_error",
      "invalid_api_key"
    );
  }

  let body: OpenAIChatCompletionRequest;
  try {
    body = (await request.json()) as OpenAIChatCompletionRequest;
  } catch {
    return openAIErrorResponse("Invalid JSON request body.", 400);
  }

  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return openAIErrorResponse(
      "Field `messages` is required and must be a non-empty array.",
      400
    );
  }

  const requestedModel = body.model || "gemini-3.8-flash";
  const isStream = Boolean(body.stream);

  try {
    // 1. Ensure valid OAuth access_token and project_id
    const { projectId: tokenProjectId } = await getValidAccessToken(env);
    const projectId =
      tokenProjectId || env.DEFAULT_PROJECT_ID || "rising-fact-p41fc";

    // 2. Convert OpenAI request to Antigravity v1internal envelope
    const { envelope } = await convertOpenAIToAntigravityRequest(
      body,
      projectId
    );

    // 3. Dispatch request to Antigravity backend (with automatic 401 token refresh & endpoint failover)
    const upstreamRes = await sendAntigravityRequest(env, envelope, isStream);

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text();
      let parsedMessage = `Antigravity upstream error (HTTP ${upstreamRes.status}): ${errText}`;
      try {
        const errJson = JSON.parse(errText) as {
          error?: { message?: string; status?: string };
        };
        if (errJson?.error?.message) {
          parsedMessage = errJson.error.message;
        }
      } catch {
        // Keep raw text
      }
      return openAIErrorResponse(
        parsedMessage,
        upstreamRes.status,
        "upstream_api_error",
        `antigravity_${upstreamRes.status}`
      );
    }

    // 4a. Streaming response -> Transform Antigravity SSE to OpenAI SSE
    if (isStream) {
      if (!upstreamRes.body) {
        return openAIErrorResponse(
          "Upstream returned an empty stream body.",
          502,
          "api_error"
        );
      }

      const openAIStream = createOpenAIStreamTransformer(
        upstreamRes.body,
        requestedModel
      );

      return new Response(openAIStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          ...CORS_HEADERS,
        },
      });
    }

    // 4b. Unary response -> Convert Antigravity JSON to OpenAI chat.completion JSON
    const antigravityPayload =
      (await upstreamRes.json()) as AntigravityResponsePayload;
    const openAIResponse = convertAntigravityToOpenAIResponse(
      antigravityPayload,
      requestedModel
    );

    return jsonResponse(openAIResponse, 200);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Unexpected internal server error.";
    const isAuthMissing = message.includes("No Antigravity OAuth credentials");
    return openAIErrorResponse(
      message,
      isAuthMissing ? 401 : 500,
      isAuthMissing ? "authentication_error" : "api_error",
      isAuthMissing ? "oauth_not_connected" : "internal_error"
    );
  }
}

/**
 * Cloudflare Worker Default Export
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    // 1. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // 2. Route `/` -> Health Check JSON
    if (path === "/" && request.method === "GET") {
      const state = await getTokenState(env).catch(() => null);
      const isConnected = Boolean(state?.refresh_token);

      return jsonResponse({
        service: "antigravity2openai-cf",
        status: "ok",
        version: "1.0.0",
        oauth_connected: isConnected,
        project_id: state?.project_id ?? null,
        endpoints: {
          setup_ui: `${url.origin}/setup`,
          models: `${url.origin}/v1/models`,
          chat_completions: `${url.origin}/v1/chat/completions`,
        },
      });
    }

    // 3. Route `/setup` and `/setup/*` -> Interactive OAuth Setup Web UI
    if (path === "/setup" || path.startsWith("/setup/")) {
      return handleSetupRequest(request, env);
    }

    // 4. Route `/v1/models` (or `/models`) -> Model List
    if (
      (path === "/v1/models" || path === "/models") &&
      request.method === "GET"
    ) {
      return handleModelsRequest(request, env);
    }

    // 5. Route `/v1/chat/completions` (or `/chat/completions`) -> Chat Handler
    if (
      (path === "/v1/chat/completions" || path === "/chat/completions") &&
      request.method === "POST"
    ) {
      return handleChatCompletionsRequest(request, env);
    }

    // 6. Fallback 404
    return openAIErrorResponse(
      `Route not found: ${request.method} ${url.pathname}`,
      404,
      "invalid_request_error",
      "route_not_found"
    );
  },
};
