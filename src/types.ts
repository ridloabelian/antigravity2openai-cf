/**
 * Cloudflare Worker Environment Bindings & Secrets
 */
export interface Env {
  /** Cloudflare KV Namespace for storing OAuth tokens & discovered project metadata */
  ANTIGRAVITY_KV: KVNamespace;

  /** Bearer token required by external OpenAI clients (Cursor, Cline, OpenCode, etc.) */
  API_KEY?: string;

  /** Password required to access the `/setup` web dashboard */
  ADMIN_PASSWORD?: string;

  /** Optional override for Google Antigravity OAuth Client ID */
  GOOGLE_CLIENT_ID?: string;

  /** Optional override for Google Antigravity OAuth Client Secret */
  GOOGLE_CLIENT_SECRET?: string;

  /** Optional fallback/override for Google Cloud Project ID */
  DEFAULT_PROJECT_ID?: string;

  /** Optional override for Antigravity User-Agent header */
  ANTIGRAVITY_USER_AGENT?: string;
}

/**
 * Stored OAuth state in Cloudflare KV
 */
export interface AntigravityTokenState {
  refresh_token: string;
  access_token: string;
  /** Epoch milliseconds when access_token expires */
  access_token_expires_at: number;
  /** Google Cloud project ID linked to the Antigravity / Cloud Code Assist session */
  project_id: string;
  /** Authenticated Google account email (if discovered) */
  user_email?: string;
  /** ISO timestamp when credentials were last updated/refreshed */
  updated_at: string;
}

// ============================================================================
// OpenAI Chat Completions API Types
// ============================================================================

export interface OpenAITextContentPart {
  type: "text";
  text: string;
}

export interface OpenAIImageUrlContentPart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export type OpenAIContentPart = OpenAITextContentPart | OpenAIImageUrlContentPart | Record<string, unknown>;

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
  /** Optional provider metadata for Gemini thoughtSignature preservation */
  extra_content?: {
    google?: {
      thought_signature?: string;
    };
  };
}

export interface OpenAIChatMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool" | "function";
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  /** Reasoning/thinking content from previous assistant turns */
  reasoning_content?: string;
}

export interface OpenAIFunctionDef {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface OpenAITool {
  type: "function";
  function: OpenAIFunctionDef;
}

export type OpenAIToolChoice =
  | "none"
  | "auto"
  | "required"
  | {
      type: "function";
      function: { name: string };
    };

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string | string[];
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  reasoning_effort?: "minimal" | "low" | "medium" | "high" | "max";
  response_format?: {
    type: "text" | "json_object" | "json_schema";
    json_schema?: {
      name?: string;
      schema?: Record<string, unknown>;
    };
  };
  /** Custom thinking config extension */
  thinking?: {
    type?: "enabled" | "disabled";
    budget_tokens?: number;
  };
  user?: string;
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

export interface OpenAIChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: "assistant";
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  } | null;
}

// ============================================================================
// Antigravity (Cloud Code Assist v1internal) Types
// ============================================================================

export interface AntigravityPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  thought_signature?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  inline_data?: {
    mime_type: string;
    data: string;
  };
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
    id?: string;
  };
  functionResponse?: {
    name: string;
    id?: string;
    response: Record<string, unknown>;
  };
}

export interface AntigravityContent {
  role: "user" | "model";
  parts: AntigravityPart[];
}

export interface AntigravityFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface AntigravityGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  responseMimeType?: string;
  responseJsonSchema?: Record<string, unknown>;
  thinkingConfig?: {
    thinkingBudget?: number;
    thinkingLevel?: string;
    includeThoughts?: boolean;
  };
}

export interface AntigravityInnerRequest {
  contents: AntigravityContent[];
  systemInstruction?: {
    role?: string;
    parts: Array<{ text: string }>;
  };
  generationConfig?: AntigravityGenerationConfig;
  tools?: Array<{
    functionDeclarations: AntigravityFunctionDeclaration[];
  }>;
  toolConfig?: {
    functionCallingConfig?: {
      mode?: "AUTO" | "ANY" | "NONE" | "VALIDATED";
      allowedFunctionNames?: string[];
    };
  };
  sessionId?: string;
}

export interface AntigravityEnvelope {
  project: string;
  model: string;
  userAgent: "antigravity";
  requestType?: "agent";
  requestId: string;
  request: AntigravityInnerRequest;
}

export interface AntigravityUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
}

export interface AntigravityCandidate {
  content?: {
    role?: string;
    parts?: AntigravityPart[];
  };
  finishReason?: "STOP" | "MAX_TOKENS" | "SAFETY" | "RECITATION" | "OTHER" | "TOOL_CALLS" | string;
}

export interface AntigravityResponsePayload {
  response?: {
    candidates?: AntigravityCandidate[];
    usageMetadata?: AntigravityUsageMetadata;
    modelVersion?: string;
    responseId?: string;
  };
  candidates?: AntigravityCandidate[];
  usageMetadata?: AntigravityUsageMetadata;
  modelVersion?: string;
  responseId?: string;
  traceId?: string;
}
