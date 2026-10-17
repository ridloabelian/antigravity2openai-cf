export interface AntigravityModelMetadata {
  id: string;
  wireModelId: string;
  owned_by: string;
  description: string;
  context_window: number;
  max_output_tokens: number;
  supports_thinking: boolean;
  default_thinking_level?: "low" | "medium" | "high";
  default_thinking_budget?: number;
}

/**
 * Curated list of models supported by Antigravity / Cloud Code Assist.
 * Includes both collapsed base models, explicit tier variants, and popular compatibility aliases.
 */
export const SUPPORTED_MODELS: AntigravityModelMetadata[] = [
  // ── Gemini 3.8 & 4 Series (Latest Antigravity Models) ──
  {
    id: "gemini-3.8-flash",
    wireModelId: "gemini-3.8-flash-medium",
    owned_by: "google-antigravity",
    description: "Gemini 3.8 Flash (Balanced medium reasoning tier)",
    context_window: 1048576,
    max_output_tokens: 65536,
    supports_thinking: true,
  },
  {
    id: "gemini-3.8-flash-low",
    wireModelId: "gemini-3.8-flash-low",
    owned_by: "google-antigravity",
    description: "Gemini 3.8 Flash (Low reasoning tier - fastest)",
    context_window: 1048576,
    max_output_tokens: 65536,
    supports_thinking: true,
  },
  {
    id: "gemini-3.8-flash-medium",
    wireModelId: "gemini-3.8-flash-medium",
    owned_by: "google-antigravity",
    description: "Gemini 3.8 Flash (Medium reasoning tier)",
    context_window: 1048576,
    max_output_tokens: 65536,
    supports_thinking: true,
  },
  {
    id: "gemini-3.8-flash-high",
    wireModelId: "gemini-3.8-flash-high",
    owned_by: "google-antigravity",
    description: "Gemini 3.8 Flash (High reasoning tier - deepest)",
    context_window: 1048576,
    max_output_tokens: 65536,
    supports_thinking: true,
  },
  {
    id: "gemini-4-argon",
    wireModelId: "gemini-4-argon-high",
    owned_by: "google-antigravity",
    description: "Gemini 4 Argon (High reasoning tier)",
    context_window: 1048576,
    max_output_tokens: 65536,
    supports_thinking: true,
  },
  {
    id: "gemini-4-argon-low",
    wireModelId: "gemini-4-argon-low",
    owned_by: "google-antigravity",
    description: "Gemini 4 Argon (Low reasoning tier)",
    context_window: 1048576,
    max_output_tokens: 65536,
    supports_thinking: true,
  },
  {
    id: "gemini-4-argon-medium",
    wireModelId: "gemini-4-argon-medium",
    owned_by: "google-antigravity",
    description: "Gemini 4 Argon (Medium reasoning tier)",
    context_window: 1048576,
    max_output_tokens: 65536,
    supports_thinking: true,
  },
  {
    id: "gemini-4-argon-high",
    wireModelId: "gemini-4-argon-high",
    owned_by: "google-antigravity",
    description: "Gemini 4 Argon (High reasoning tier)",
    context_window: 1048576,
    max_output_tokens: 65536,
    supports_thinking: true,
  },

  // ── Gemini 3.7 / 3.1 / 3.0 Series ──
  {
    id: "gemini-3.7-flash",
    wireModelId: "gemini-3.7-flash-tiered",
    owned_by: "google-antigravity",
    description: "Gemini 3.7 Flash (Tiered reasoning)",
    context_window: 1048576,
    max_output_tokens: 65536,
    supports_thinking: true,
    default_thinking_level: "medium",
  },
  {
    id: "gemini-3.1-pro-preview",
    wireModelId: "gemini-pro-agent",
    owned_by: "google-antigravity",
    description: "Gemini 3.1 Pro Preview (High reasoning agent model)",
    context_window: 1048576,
    max_output_tokens: 65535,
    supports_thinking: true,
    default_thinking_level: "high",
  },
  {
    id: "gemini-3.1-pro",
    wireModelId: "gemini-pro-agent",
    owned_by: "google-antigravity",
    description: "Gemini 3.1 Pro (High reasoning agent model)",
    context_window: 1048576,
    max_output_tokens: 65535,
    supports_thinking: true,
    default_thinking_level: "high",
  },
  {
    id: "gemini-3.1-pro-low",
    wireModelId: "gemini-3.1-pro-low",
    owned_by: "google-antigravity",
    description: "Gemini 3.1 Pro (Low reasoning tier)",
    context_window: 1048576,
    max_output_tokens: 65535,
    supports_thinking: true,
  },
  {
    id: "gemini-3-flash",
    wireModelId: "gemini-3.7-flash-tiered",
    owned_by: "google-antigravity",
    description: "Gemini 3 Flash (Routed via active Antigravity Flash tier)",
    context_window: 1048576,
    max_output_tokens: 65536,
    supports_thinking: true,
    default_thinking_level: "medium",
  },
  {
    id: "gemini-2.5-pro",
    wireModelId: "gemini-2.5-pro",
    owned_by: "google-antigravity",
    description: "Gemini 2.5 Pro (Cloud Code Assist quota pool)",
    context_window: 1048576,
    max_output_tokens: 65536,
    supports_thinking: false,
  },
  {
    id: "gemini-2.5-flash",
    wireModelId: "gemini-2.5-flash",
    owned_by: "google-antigravity",
    description: "Gemini 2.5 Flash (Fast Cloud Code Assist model)",
    context_window: 1048576,
    max_output_tokens: 65536,
    supports_thinking: false,
  },

  // ── Anthropic Claude Models on Antigravity (Vertex Partner Routing) ──
  {
    id: "claude-sonnet-5-5",
    wireModelId: "claude-sonnet-5-5-medium",
    owned_by: "anthropic-antigravity",
    description: "Claude Sonnet 5.5 on Antigravity (Medium tier)",
    context_window: 1000000,
    max_output_tokens: 64000,
    supports_thinking: true,
  },
  {
    id: "claude-sonnet-5-5-high",
    wireModelId: "claude-sonnet-5-5-high",
    owned_by: "anthropic-antigravity",
    description: "Claude Sonnet 5.5 on Antigravity (High tier)",
    context_window: 1000000,
    max_output_tokens: 64000,
    supports_thinking: true,
  },
  {
    id: "claude-opus-5-5",
    wireModelId: "claude-opus-5-5-medium",
    owned_by: "anthropic-antigravity",
    description: "Claude Opus 5.5 on Antigravity (Medium tier)",
    context_window: 1000000,
    max_output_tokens: 64000,
    supports_thinking: true,
  },
  {
    id: "claude-opus-5-5-high",
    wireModelId: "claude-opus-5-5-high",
    owned_by: "anthropic-antigravity",
    description: "Claude Opus 5.5 on Antigravity (High tier)",
    context_window: 1000000,
    max_output_tokens: 64000,
    supports_thinking: true,
  },
  {
    id: "claude-sonnet-4-6",
    wireModelId: "claude-sonnet-4-6",
    owned_by: "anthropic-antigravity",
    description: "Claude Sonnet 4.6 on Antigravity",
    context_window: 250000,
    max_output_tokens: 64000,
    supports_thinking: true,
  },
  {
    id: "claude-opus-4-6-thinking",
    wireModelId: "claude-opus-4-6-thinking",
    owned_by: "anthropic-antigravity",
    description: "Claude Opus 4.6 Thinking on Antigravity",
    context_window: 250000,
    max_output_tokens: 64000,
    supports_thinking: true,
    default_thinking_budget: 8192,
  },
  {
    id: "claude-sonnet-4-5",
    wireModelId: "claude-sonnet-4-5",
    owned_by: "anthropic-antigravity",
    description: "Claude Sonnet 4.5 on Antigravity",
    context_window: 200000,
    max_output_tokens: 64000,
    supports_thinking: false,
  },
  {
    id: "claude-sonnet-4-5-thinking",
    wireModelId: "claude-sonnet-4-5-thinking",
    owned_by: "anthropic-antigravity",
    description: "Claude Sonnet 4.5 Thinking on Antigravity",
    context_window: 200000,
    max_output_tokens: 64000,
    supports_thinking: true,
    default_thinking_budget: 8192,
  },
  {
    id: "claude-opus-4-5-thinking",
    wireModelId: "claude-opus-4-5-thinking",
    owned_by: "anthropic-antigravity",
    description: "Claude Opus 4.5 Thinking on Antigravity",
    context_window: 200000,
    max_output_tokens: 64000,
    supports_thinking: true,
    default_thinking_budget: 8192,
  },
  {
    id: "claude-3-7-sonnet",
    wireModelId: "claude-sonnet-4-6",
    owned_by: "anthropic-antigravity",
    description: "Claude 3.7 Sonnet (Compatible alias routed to active Antigravity Claude Sonnet)",
    context_window: 200000,
    max_output_tokens: 64000,
    supports_thinking: true,
  },
  {
    id: "claude-3-5-sonnet",
    wireModelId: "claude-sonnet-4-6",
    owned_by: "anthropic-antigravity",
    description: "Claude 3.5 Sonnet (Compatible alias routed to active Antigravity Claude Sonnet)",
    context_window: 200000,
    max_output_tokens: 64000,
    supports_thinking: false,
  },

  // ── Open-Weights / Other Models on Antigravity ──
  {
    id: "gpt-oss-120b-medium",
    wireModelId: "gpt-oss-120b-medium",
    owned_by: "google-antigravity",
    description: "GPT-OSS 120B (Medium reasoning tier)",
    context_window: 131072,
    max_output_tokens: 32768,
    supports_thinking: true,
  },
];

/**
 * Effort-based suffix map for models that use distinct wire IDs per reasoning effort
 */
const EFFORT_SUFFIX_WIRE_MAP: Record<string, Record<"low" | "medium" | "high", string>> = {
  "gemini-3.8-flash": {
    low: "gemini-3.8-flash-low",
    medium: "gemini-3.8-flash-medium",
    high: "gemini-3.8-flash-high",
  },
  "gemini-4-argon": {
    low: "gemini-4-argon-low",
    medium: "gemini-4-argon-medium",
    high: "gemini-4-argon-high",
  },
  "claude-sonnet-5-5": {
    low: "claude-sonnet-5-5-low",
    medium: "claude-sonnet-5-5-medium",
    high: "claude-sonnet-5-5-high",
  },
  "claude-opus-5-5": {
    low: "claude-opus-5-5-low",
    medium: "claude-opus-5-5-medium",
    high: "claude-opus-5-5-high",
  },
  "gemini-3.1-pro": {
    low: "gemini-3.1-pro-low",
    medium: "gemini-pro-agent",
    high: "gemini-pro-agent",
  },
  "gemini-3.1-pro-preview": {
    low: "gemini-3.1-pro-low",
    medium: "gemini-pro-agent",
    high: "gemini-pro-agent",
  },
};

function normalizeEffort(effort?: string): "low" | "medium" | "high" | undefined {
  if (!effort) return undefined;
  const e = effort.toLowerCase().trim();
  if (e === "minimal" || e === "low") return "low";
  if (e === "medium") return "medium";
  if (e === "high" || e === "max" || e === "xhigh") return "high";
  return undefined;
}

/**
 * Resolve any requested OpenAI model string + optional reasoning effort into the
 * exact Antigravity wire model ID and thinking parameters.
 */
export function resolveAntigravityModel(
  requestedModel: string,
  reasoningEffort?: string,
): {
  wireModelId: string;
  thinkingLevel?: "low" | "medium" | "high";
  thinkingBudget?: number;
  isClaude: boolean;
  requiresCliUserAgent: boolean;
  maxOutputTokensCeiling: number;
} {
  // Strip optional provider prefix like `google/` or `antigravity-`
  let cleanId = requestedModel.trim();
  if (cleanId.includes("/")) {
    cleanId = cleanId.slice(cleanId.lastIndexOf("/") + 1);
  }
  if (cleanId.startsWith("antigravity-")) {
    cleanId = cleanId.slice("antigravity-".length);
  }

  const normalizedEffort = normalizeEffort(reasoningEffort);

  // 1. Check if model is a base family with effort-suffixed wire IDs
  const effortMap = EFFORT_SUFFIX_WIRE_MAP[cleanId];
  if (effortMap) {
    const chosenEffort = normalizedEffort || (cleanId.startsWith("gemini-3.1-pro") ? "high" : "medium");
    const wireModelId = effortMap[chosenEffort];
    const isProAgent = wireModelId === "gemini-pro-agent";
    return {
      wireModelId,
      // Suffix-tiered models encode effort in the wire ID itself; only `gemini-pro-agent` takes thinkingLevel
      thinkingLevel: isProAgent ? chosenEffort : undefined,
      isClaude: wireModelId.startsWith("claude"),
      requiresCliUserAgent: wireModelId.startsWith("gemini-4-argon"),
      maxOutputTokensCeiling: wireModelId.startsWith("claude") ? 64000 : isProAgent ? 65535 : 65536,
    };
  }

  // 2. Look up in SUPPORTED_MODELS
  const found = SUPPORTED_MODELS.find((m) => m.id === cleanId || m.wireModelId === cleanId);
  if (found) {
    const wireModelId = found.wireModelId;
    const isClaude = wireModelId.startsWith("claude");
    const requiresCliUserAgent = wireModelId.startsWith("gemini-4-argon");
    let thinkingLevel = found.default_thinking_level;
    let thinkingBudget = found.default_thinking_budget;

    if (normalizedEffort && found.supports_thinking) {
      if (wireModelId === "gemini-3.7-flash-tiered" || wireModelId === "gemini-pro-agent") {
        thinkingLevel = normalizedEffort;
      } else if (isClaude && wireModelId.endsWith("-thinking")) {
        thinkingBudget = normalizedEffort === "high" ? 32768 : normalizedEffort === "low" ? 8192 : 16384;
      }
    }

    return {
      wireModelId,
      thinkingLevel,
      thinkingBudget,
      isClaude,
      requiresCliUserAgent,
      maxOutputTokensCeiling: found.max_output_tokens,
    };
  }

  // 3. Pass-through for any newly released or custom model ID
  const isClaude = cleanId.startsWith("claude");
  const requiresCliUserAgent = cleanId.startsWith("gemini-4-argon");
  return {
    wireModelId: cleanId,
    thinkingLevel: normalizedEffort,
    isClaude,
    requiresCliUserAgent,
    maxOutputTokensCeiling: isClaude ? 64000 : 65536,
  };
}

/**
 * Format the OpenAI `GET /v1/models` list response, optionally merging dynamically
 * discovered model IDs from Antigravity's `:fetchAvailableModels` endpoint.
 */
export function buildOpenAIModelsList(discoveredIds: string[] = []) {
  const created = 1735689600; // Fixed epoch timestamp for OpenAI compatibility
  const seen = new Set<string>();
  const data: Array<{
    id: string;
    object: "model";
    created: number;
    owned_by: string;
  }> = [];

  for (const model of SUPPORTED_MODELS) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    data.push({
      id: model.id,
      object: "model",
      created,
      owned_by: model.owned_by,
    });
  }

  for (const rawId of discoveredIds) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    data.push({
      id,
      object: "model",
      created,
      owned_by: id.startsWith("claude") ? "anthropic-antigravity" : "google-antigravity",
    });
  }

  return {
    object: "list" as const,
    data,
  };
}
