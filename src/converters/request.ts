import { resolveAntigravityModel } from "./models";
import type {
  AntigravityContent,
  AntigravityEnvelope,
  AntigravityFunctionDeclaration,
  AntigravityGenerationConfig,
  AntigravityInnerRequest,
  AntigravityPart,
  OpenAIChatCompletionRequest,
  OpenAIChatMessage,
  OpenAIContentPart,
} from "../types";

const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

const REJECTED_CLAUDE_SDK_PARAGRAPH =
  "You are a Claude agent, built on Anthropic's Claude Agent SDK.";

/**
 * Sanitize function/tool name to comply with Antigravity naming rules:
 * - First char must be a letter (a-z, A-Z) or underscore (_)
 * - Allowed chars: a-zA-Z0-9, underscore (_), dot (.), colon (:), hyphen (-)
 * - Max length: 64 chars
 */
export function sanitizeFunctionName(name: string): string {
  let cleaned = name.trim().replace(/[^a-zA-Z0-9_.:-]/g, "_");
  if (!cleaned || !/^[a-zA-Z_]/.test(cleaned)) {
    cleaned = `_${cleaned}`;
  }
  return cleaned.slice(0, 64);
}

/**
 * Sanitize tool_call_id so it is valid for both Gemini and Claude-on-Antigravity (`[a-zA-Z0-9_-]`).
 */
export function sanitizeToolCallId(id?: string): string | undefined {
  if (!id || typeof id !== "string" || !id.trim()) return undefined;
  return id.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/**
 * Recursively clean a JSON Schema object so that Antigravity / Cloud Code Assist
 * does not return HTTP 400 INVALID_ARGUMENT on unsupported JSON Schema keywords.
 */
export function cleanJsonSchemaForAntigravity(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }

  const raw = schema as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};

  // Convert `const` to `enum: [value]`
  if ("const" in raw && raw.const !== undefined) {
    cleaned.enum = [raw.const];
  }

  // Handle type (including nullable union types like `["string", "null"]`)
  if (Array.isArray(raw.type)) {
    const nonNullTypes = raw.type.filter((t) => t !== "null" && typeof t === "string");
    cleaned.type = nonNullTypes[0] || "string";
  } else if (typeof raw.type === "string") {
    cleaned.type = raw.type;
  }

  if (typeof raw.description === "string" && raw.description.length > 0) {
    cleaned.description = raw.description;
  }

  if (Array.isArray(raw.enum)) {
    cleaned.enum = raw.enum;
  }

  // Clean properties
  if (raw.properties && typeof raw.properties === "object" && !Array.isArray(raw.properties)) {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(raw.properties as Record<string, unknown>)) {
      props[key] = cleanJsonSchemaForAntigravity(val);
    }
    cleaned.properties = props;
    if (!cleaned.type) {
      cleaned.type = "object";
    }
  }

  // Clean required array (only keep keys that exist in properties if properties is present)
  if (Array.isArray(raw.required)) {
    const validRequired = raw.required.filter((r): r is string => typeof r === "string");
    if (cleaned.properties && typeof cleaned.properties === "object") {
      const propKeys = new Set(Object.keys(cleaned.properties as Record<string, unknown>));
      const filtered = validRequired.filter((k) => propKeys.has(k));
      if (filtered.length > 0) {
        cleaned.required = filtered;
      }
    } else if (validRequired.length > 0) {
      cleaned.required = validRequired;
    }
  }

  // Clean array items
  if (raw.items && typeof raw.items === "object") {
    cleaned.items = Array.isArray(raw.items)
      ? cleanJsonSchemaForAntigravity(raw.items[0])
      : cleanJsonSchemaForAntigravity(raw.items);
    if (!cleaned.type) {
      cleaned.type = "array";
    }
  }

  // Handle combinators (anyOf / oneOf / allOf)
  for (const comb of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(raw[comb])) {
      const subSchemas = (raw[comb] as unknown[])
        .filter((item) => {
          if (item && typeof item === "object" && (item as { type?: unknown }).type === "null") {
            return false;
          }
          return true;
        })
        .map((item) => cleanJsonSchemaForAntigravity(item));
      if (subSchemas.length === 1) {
        Object.assign(cleaned, subSchemas[0]);
      } else if (subSchemas.length > 1) {
        cleaned[comb] = subSchemas;
      }
    }
  }

  if (!cleaned.type && !cleaned.anyOf && !cleaned.oneOf && !cleaned.allOf) {
    cleaned.type = "object";
  }

  return cleaned;
}

/**
 * Extract plain text from an OpenAI message content field.
 */
function extractTextFromContent(content: OpenAIChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object") {
      if ((part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string") {
        texts.push((part as { text: string }).text);
      }
    }
  }
  return texts.join("\n");
}

/**
 * Parse a `data:<mimeType>;base64,<data>` URL into Gemini `inlineData`.
 */
function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(url.trim());
  if (!match) return null;
  return {
    mimeType: match[1]!,
    data: match[2]!,
  };
}

/**
 * Convert OpenAI multimodal content parts into Antigravity `parts`.
 */
function convertUserContentToParts(content: OpenAIChatMessage["content"]): AntigravityPart[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ text: content }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: AntigravityPart[] = [];
  for (const item of content as OpenAIContentPart[]) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text" && typeof item.text === "string" && item.text.length > 0) {
      parts.push({ text: item.text });
    } else if (
      item.type === "image_url" &&
      item.image_url &&
      typeof (item.image_url as { url?: unknown }).url === "string"
    ) {
      const rawUrl = (item.image_url as { url: string }).url;
      const parsed = parseDataUrl(rawUrl);
      if (parsed) {
        parts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data,
          },
        });
      } else {
        parts.push({ text: `[Image: ${rawUrl}]` });
      }
    }
  }
  return parts;
}

/**
 * Generate a deterministic `-<uint63>` session ID from the first user message using Web Crypto SHA-256.
 */
async function generateSessionId(firstUserText: string): Promise<string> {
  if (!firstUserText) {
    return `-${Math.floor(Math.random() * 9e15).toString()}`;
  }
  const bytes = new TextEncoder().encode(firstUserText);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const view = new DataView(hashBuffer);
  const high = BigInt(view.getUint32(0, false));
  const low = BigInt(view.getUint32(4, false));
  const combined = ((high << 32n) | low) & 0x7fffffffffffffffn;
  return `-${combined.toString()}`;
}

/**
 * Sanitize system prompt text to avoid false 429 rejections on Antigravity Flash models.
 */
function sanitizeSystemText(rawSystem: string): string {
  return rawSystem
    .replace(/^x-anthropic-billing-header:[^\n]*\n*/i, "")
    .split("\n\n")
    .filter((p) => p.trim() !== REJECTED_CLAUDE_SDK_PARAGRAPH)
    .join("\n\n")
    .trim();
}

/**
 * Convert an OpenAI `/v1/chat/completions` request payload into an Antigravity `v1internal` envelope.
 */
export async function convertOpenAIToAntigravityRequest(
  openAIReq: OpenAIChatCompletionRequest,
  projectId: string,
): Promise<{
  envelope: AntigravityEnvelope;
  wireModelId: string;
  requestedModel: string;
}> {
  const requestedModel = openAIReq.model || "gemini-3.8-flash";
  const resolved = resolveAntigravityModel(requestedModel, openAIReq.reasoning_effort);
  const { wireModelId, isClaude, maxOutputTokensCeiling } = resolved;

  const systemParts: Array<{ text: string }> = [];
  const contents: AntigravityContent[] = [];

  // Map tool_call_id -> function name so `role: "tool"` messages know which function name to report
  const toolCallIdToName = new Map<string, string>();
  let firstUserText = "";

  for (const msg of openAIReq.messages || []) {
    if (!msg || typeof msg !== "object") continue;

    // 1. System / Developer messages -> systemInstruction
    if (msg.role === "system" || msg.role === "developer") {
      const sysText = sanitizeSystemText(extractTextFromContent(msg.content));
      if (sysText.length > 0) {
        systemParts.push({ text: sysText });
      }
      continue;
    }

    // 2. User messages
    if (msg.role === "user") {
      const userParts = convertUserContentToParts(msg.content);
      if (!firstUserText) {
        const firstTextPart = userParts.find((p) => typeof p.text === "string");
        if (firstTextPart?.text) {
          firstUserText = firstTextPart.text;
        }
      }
      if (userParts.length > 0) {
        contents.push({
          role: "user",
          parts: userParts,
        });
      }
      continue;
    }

    // 3. Assistant messages -> `role: "model"`
    if (msg.role === "assistant") {
      const modelParts: AntigravityPart[] = [];

      const textContent = extractTextFromContent(msg.content);
      if (textContent.length > 0) {
        modelParts.push({ text: textContent });
      }

      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        msg.tool_calls.forEach((tc, idx) => {
          if (!tc?.function?.name) return;
          const fnName = sanitizeFunctionName(tc.function.name);
          const sanitizedId = sanitizeToolCallId(tc.id) || `call_${idx}_${Date.now()}`;
          if (tc.id) {
            toolCallIdToName.set(tc.id, fnName);
          }
          toolCallIdToName.set(sanitizedId, fnName);

          let parsedArgs: Record<string, unknown> = {};
          if (typeof tc.function.arguments === "string" && tc.function.arguments.trim().length > 0) {
            try {
              const parsed = JSON.parse(tc.function.arguments);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                parsedArgs = parsed as Record<string, unknown>;
              } else {
                parsedArgs = { value: parsed };
              }
            } catch {
              parsedArgs = { raw_arguments: tc.function.arguments };
            }
          }

          const part: AntigravityPart = {
            functionCall: {
              name: fnName,
              args: parsedArgs,
              id: sanitizedId,
            },
          };

          // Gemini models on Antigravity require a thoughtSignature on the first functionCall in a model turn
          if (!isClaude) {
            const existingSig = tc.extra_content?.google?.thought_signature;
            if (typeof existingSig === "string" && existingSig.length >= 16) {
              part.thoughtSignature = existingSig;
            } else if (idx === 0) {
              part.thoughtSignature = SKIP_THOUGHT_SIGNATURE;
            }
          }

          modelParts.push(part);
        });
      }

      if (modelParts.length > 0) {
        contents.push({
          role: "model",
          parts: modelParts,
        });
      }
      continue;
    }

    // 4. Tool / Function result messages -> `role: "user"` with `functionResponse`
    if (msg.role === "tool" || msg.role === "function") {
      const rawId = msg.tool_call_id;
      const sanitizedId = sanitizeToolCallId(rawId);
      const resolvedName =
        (rawId && toolCallIdToName.get(rawId)) ||
        (sanitizedId && toolCallIdToName.get(sanitizedId)) ||
        (msg.name ? sanitizeFunctionName(msg.name) : "tool_result");

      const resultText = extractTextFromContent(msg.content);
      let responseObj: Record<string, unknown>;
      try {
        const parsed = JSON.parse(resultText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          responseObj = parsed as Record<string, unknown>;
        } else {
          responseObj = { result: parsed };
        }
      } catch {
        responseObj = { result: resultText || "(empty)" };
      }

      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: resolvedName,
              ...(sanitizedId ? { id: sanitizedId } : {}),
              response: responseObj,
            },
          },
        ],
      });
    }
  }

  // Merge consecutive turns with the same role (required by Gemini & Claude-on-Antigravity)
  const mergedContents: AntigravityContent[] = [];
  for (const turn of contents) {
    if (turn.parts.length === 0) continue;
    const prev = mergedContents[mergedContents.length - 1];
    if (prev && prev.role === turn.role) {
      prev.parts.push(...turn.parts);
    } else {
      mergedContents.push({
        role: turn.role,
        parts: [...turn.parts],
      });
    }
  }

  // Ensure non-empty contents starting with user
  if (mergedContents.length === 0) {
    mergedContents.push({
      role: "user",
      parts: [{ text: "Hello" }],
    });
  } else if (mergedContents[mergedContents.length - 1]?.role === "model") {
    // Antigravity rejects requests that end with a `model` turn
    mergedContents.push({
      role: "user",
      parts: [{ text: "(continue)" }],
    });
  }

  // Ensure Gemini model turns with functionCalls always have a thoughtSignature on the first functionCall
  if (!isClaude) {
    for (const turn of mergedContents) {
      if (turn.role !== "model") continue;
      for (const part of turn.parts) {
        if (part.functionCall) {
          if (!part.thoughtSignature && !part.thought_signature) {
            part.thoughtSignature = SKIP_THOUGHT_SIGNATURE;
          }
          break;
        }
      }
    }
  }

  // Build generationConfig
  const generationConfig: AntigravityGenerationConfig = {};
  const requestedMaxTokens = openAIReq.max_completion_tokens ?? openAIReq.max_tokens;
  if (typeof requestedMaxTokens === "number" && requestedMaxTokens > 0) {
    generationConfig.maxOutputTokens = Math.min(requestedMaxTokens, maxOutputTokensCeiling);
  }
  if (typeof openAIReq.temperature === "number") {
    generationConfig.temperature = openAIReq.temperature;
  }
  if (typeof openAIReq.top_p === "number") {
    generationConfig.topP = openAIReq.top_p;
  }
  if (openAIReq.stop) {
    generationConfig.stopSequences = Array.isArray(openAIReq.stop)
      ? openAIReq.stop
      : [openAIReq.stop];
  }

  // Structured JSON output support
  if (openAIReq.response_format && !isClaude) {
    if (openAIReq.response_format.type === "json_object") {
      generationConfig.responseMimeType = "application/json";
    } else if (
      openAIReq.response_format.type === "json_schema" &&
      openAIReq.response_format.json_schema?.schema
    ) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseJsonSchema = openAIReq.response_format.json_schema.schema;
    }
  }

  // Configure thinking / extended reasoning
  const explicitBudget =
    openAIReq.thinking?.type === "enabled" && typeof openAIReq.thinking.budget_tokens === "number"
      ? openAIReq.thinking.budget_tokens
      : resolved.thinkingBudget;

  if (openAIReq.thinking?.type !== "disabled") {
    if (typeof explicitBudget === "number" && explicitBudget > 0) {
      generationConfig.thinkingConfig = {
        thinkingBudget: explicitBudget,
        includeThoughts: true,
      };
      // Antigravity requires maxOutputTokens > thinkingBudget
      if (
        !generationConfig.maxOutputTokens ||
        generationConfig.maxOutputTokens <= explicitBudget
      ) {
        generationConfig.maxOutputTokens = Math.min(explicitBudget + 8192, maxOutputTokensCeiling);
      }
    } else if (resolved.thinkingLevel) {
      generationConfig.thinkingConfig = {
        thinkingLevel: resolved.thinkingLevel,
        ...(!isClaude ? { includeThoughts: true } : {}),
      };
    }
  }

  const sessionId = await generateSessionId(firstUserText);

  const innerRequest: AntigravityInnerRequest = {
    contents: mergedContents,
    sessionId,
  };

  if (systemParts.length > 0) {
    innerRequest.systemInstruction = {
      parts: systemParts,
    };
  }

  if (Object.keys(generationConfig).length > 0) {
    innerRequest.generationConfig = generationConfig;
  }

  // Convert OpenAI tools -> Antigravity functionDeclarations
  if (Array.isArray(openAIReq.tools) && openAIReq.tools.length > 0 && openAIReq.tool_choice !== "none") {
    const declarations: AntigravityFunctionDeclaration[] = [];
    for (const tool of openAIReq.tools) {
      if (tool?.type !== "function" || !tool.function?.name) continue;
      declarations.push({
        name: sanitizeFunctionName(tool.function.name),
        description: tool.function.description || "",
        parameters: cleanJsonSchemaForAntigravity(tool.function.parameters),
      });
    }

    if (declarations.length > 0) {
      innerRequest.tools = [{ functionDeclarations: declarations }];

      if (isClaude) {
        // Claude on Antigravity requires mode: "VALIDATED"
        innerRequest.toolConfig = {
          functionCallingConfig: {
            mode: "VALIDATED",
          },
        };
      } else if (openAIReq.tool_choice === "required") {
        innerRequest.toolConfig = {
          functionCallingConfig: {
            mode: "ANY",
          },
        };
      } else if (
        openAIReq.tool_choice &&
        typeof openAIReq.tool_choice === "object" &&
        openAIReq.tool_choice.type === "function" &&
        openAIReq.tool_choice.function?.name
      ) {
        innerRequest.toolConfig = {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: [sanitizeFunctionName(openAIReq.tool_choice.function.name)],
          },
        };
      }
    }
  }

  const envelope: AntigravityEnvelope = {
    project: projectId,
    model: wireModelId,
    userAgent: "antigravity",
    requestType: "agent",
    requestId: `agent-${crypto.randomUUID()}`,
    request: innerRequest,
  };

  return {
    envelope,
    wireModelId,
    requestedModel,
  };
}
