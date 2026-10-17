import {
  AntigravityCandidate,
  AntigravityResponsePayload,
  AntigravityUsageMetadata,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionResponse,
  OpenAIToolCall,
} from "../types";

/**
 * Helper to convert Antigravity UsageMetadata to OpenAI Usage object.
 */
function mapUsageMetadata(
  usage?: AntigravityUsageMetadata
): OpenAIChatCompletionResponse["usage"] | undefined {
  if (!usage) return undefined;

  const promptTokens = usage.promptTokenCount ?? 0;
  const candidateTokens = usage.candidatesTokenCount ?? 0;
  const reasoningTokens = usage.thoughtsTokenCount ?? 0;
  const completionTokens = candidateTokens + reasoningTokens;
  const totalTokens = usage.totalTokenCount ?? promptTokens + completionTokens;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    ...(reasoningTokens > 0
      ? {
          completion_tokens_details: {
            reasoning_tokens: reasoningTokens,
          },
        }
      : {}),
  };
}

/**
 * Helper to map Antigravity / Gemini finishReason to OpenAI finish_reason.
 */
function mapFinishReason(
  rawReason: string | undefined,
  hasToolCalls: boolean
): "stop" | "length" | "tool_calls" | "content_filter" {
  if (hasToolCalls) {
    return "tool_calls";
  }
  switch (rawReason) {
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
      return "content_filter";
    case "TOOL_CALLS":
    case "MALFORMED_FUNCTION_CALL":
      return "tool_calls";
    case "STOP":
    default:
      return "stop";
  }
}

/**
 * Convert a unary (non-streaming) Antigravity response into an OpenAI Chat Completion response.
 */
export function convertAntigravityToOpenAIResponse(
  payload: AntigravityResponsePayload,
  requestedModel: string
): OpenAIChatCompletionResponse {
  const inner = payload.response ?? payload;
  const candidates: AntigravityCandidate[] = inner.candidates ?? [];
  const usageMetadata = inner.usageMetadata;
  const responseId =
    inner.responseId || payload.traceId || `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  const primaryCandidate = candidates[0];
  const parts = primaryCandidate?.content?.parts ?? [];

  let textContent = "";
  let reasoningContent = "";
  const toolCalls: OpenAIToolCall[] = [];
  let lastThoughtSignature: string | undefined;

  for (const part of parts) {
    const sig = part.thoughtSignature || part.thought_signature;
    if (sig) {
      lastThoughtSignature = sig;
    }

    if (part.thought === true && typeof part.text === "string") {
      reasoningContent += part.text;
      continue;
    }

    if (typeof part.text === "string" && !part.thought) {
      textContent += part.text;
    }

    if (part.functionCall) {
      const callId =
        part.functionCall.id ||
        `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
      const argsStr =
        typeof part.functionCall.args === "string"
          ? part.functionCall.args
          : JSON.stringify(part.functionCall.args ?? {});

      const toolCall: OpenAIToolCall = {
        id: callId,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: argsStr,
        },
      };

      const effectiveSig = sig || lastThoughtSignature;
      if (effectiveSig) {
        toolCall.extra_content = {
          google: {
            thought_signature: effectiveSig,
          },
        };
      }

      toolCalls.push(toolCall);
    }
  }

  const hasToolCalls = toolCalls.length > 0;
  const finishReason = mapFinishReason(
    primaryCandidate?.finishReason,
    hasToolCalls
  );

  return {
    id: responseId.startsWith("chatcmpl-")
      ? responseId
      : `chatcmpl-${responseId}`,
    object: "chat.completion",
    created,
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: textContent.length > 0 ? textContent : hasToolCalls ? null : "",
          ...(reasoningContent.length > 0
            ? { reasoning_content: reasoningContent }
            : {}),
          ...(hasToolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: mapUsageMetadata(usageMetadata) ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

/**
 * Transform an upstream Antigravity SSE ReadableStream into an OpenAI-compatible SSE stream.
 */
export function createOpenAIStreamTransformer(
  upstreamBody: ReadableStream<Uint8Array>,
  requestedModel: string
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const completionId = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);

  let buffer = "";
  let sentRoleDelta = false;
  let toolCallIndex = 0;
  let hasToolCalls = false;
  let lastFinishReason: string | undefined;
  let latestUsage: AntigravityUsageMetadata | undefined;
  let lastThoughtSignature: string | undefined;

  const enqueueChunk = (
    controller: TransformStreamDefaultController<Uint8Array>,
    chunk: OpenAIChatCompletionChunk
  ) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  };

  const ensureRoleSent = (
    controller: TransformStreamDefaultController<Uint8Array>
  ) => {
    if (!sentRoleDelta) {
      sentRoleDelta = true;
      enqueueChunk(controller, {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: requestedModel,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "" },
            finish_reason: null,
          },
        ],
      });
    }
  };

  const processDataLine = (
    jsonStr: string,
    controller: TransformStreamDefaultController<Uint8Array>
  ) => {
    const trimmed = jsonStr.trim();
    if (!trimmed || trimmed === "[DONE]") {
      return;
    }

    let payload: AntigravityResponsePayload;
    try {
      payload = JSON.parse(trimmed) as AntigravityResponsePayload;
    } catch {
      return;
    }

    const inner = payload.response ?? payload;
    if (inner.usageMetadata) {
      latestUsage = inner.usageMetadata;
    }

    const candidates = inner.candidates ?? [];
    const candidate = candidates[0];
    if (!candidate) return;

    if (candidate.finishReason) {
      lastFinishReason = candidate.finishReason;
    }

    const parts = candidate.content?.parts ?? [];
    for (const part of parts) {
      const sig = part.thoughtSignature || part.thought_signature;
      if (sig) {
        lastThoughtSignature = sig;
      }

      // 1. Thinking / Reasoning delta
      if (part.thought === true && typeof part.text === "string" && part.text.length > 0) {
        ensureRoleSent(controller);
        enqueueChunk(controller, {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: requestedModel,
          choices: [
            {
              index: 0,
              delta: {
                reasoning_content: part.text,
              },
              finish_reason: null,
            },
          ],
        });
        continue;
      }

      // 2. Normal text delta
      if (typeof part.text === "string" && !part.thought && part.text.length > 0) {
        ensureRoleSent(controller);
        enqueueChunk(controller, {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: requestedModel,
          choices: [
            {
              index: 0,
              delta: {
                content: part.text,
              },
              finish_reason: null,
            },
          ],
        });
      }

      // 3. Tool / Function call delta
      if (part.functionCall) {
        ensureRoleSent(controller);
        hasToolCalls = true;
        const callId =
          part.functionCall.id ||
          `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
        const argsStr =
          typeof part.functionCall.args === "string"
            ? part.functionCall.args
            : JSON.stringify(part.functionCall.args ?? {});

        const currentIdx = toolCallIndex++;
        const toolCallDelta: {
          index: number;
          id: string;
          type: "function";
          function: {
            name: string;
            arguments: string;
          };
          extra_content?: {
            google?: {
              thought_signature?: string;
            };
          };
        } = {
          index: currentIdx,
          id: callId,
          type: "function",
          function: {
            name: part.functionCall.name,
            arguments: argsStr,
          },
        };

        const effectiveSig = sig || lastThoughtSignature;
        if (effectiveSig) {
          toolCallDelta.extra_content = {
            google: {
              thought_signature: effectiveSig,
            },
          };
        }

        enqueueChunk(controller, {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: requestedModel,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [toolCallDelta],
              },
              finish_reason: null,
            },
          ],
        });
      }
    }
  };

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith("data:")) {
          const dataContent = trimmedLine.slice(5).trim();
          processDataLine(dataContent, controller);
        }
      }
    },
    flush(controller) {
      if (buffer.trim().length > 0) {
        const remainingLines = buffer.split(/\r?\n/);
        for (const line of remainingLines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith("data:")) {
            const dataContent = trimmedLine.slice(5).trim();
            processDataLine(dataContent, controller);
          }
        }
      }

      ensureRoleSent(controller);

      const finalFinishReason = mapFinishReason(lastFinishReason, hasToolCalls);
      const mappedUsage = mapUsageMetadata(latestUsage);

      enqueueChunk(controller, {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: requestedModel,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: finalFinishReason,
          },
        ],
        ...(mappedUsage ? { usage: mappedUsage } : {}),
      });

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  });

  return upstreamBody.pipeThrough(transformStream);
}
