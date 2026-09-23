export { ContextGuard } from "./context-guard.js";
export { ContextMonitor } from "./context-monitor.js";

import type { GatewayEntry, LegacyUpstream, UpstreamProvider } from "../providers/index.js";

export type { GatewayEntry, LegacyUpstream, UpstreamProvider };

import {
  perGatewayEnvVar,
  type ResolvedUpstream,
  type ResolveResult,
  resolveActiveUpstream,
  resolveUpstreamDisplay,
  type UpstreamDisplay,
  type UpstreamDisplaySettings,
} from "../providers/index.js";

export { createGeminiToAnthropicSSE, GeminiSSETranslator } from "../providers/gemini-stream.js";
export {
  anthropicToGemini,
  type GeminiRequest,
  geminiPath,
  geminiToAnthropic,
  mapGeminiFinish,
} from "../providers/gemini-translate.js";
export { sniffRequestModel, stripVendorPrefix } from "../providers/model-display.js";
export { createOpenAIToAnthropicSSE, OpenAIChatSSETranslator } from "../providers/openai-stream.js";
export {
  type AnthropicMessageResponse,
  anthropicToOpenAIChat,
  countAnthropicInputTokens,
  countTokensResponse,
  EmptyCompletionError,
  emptyAnswerNotice,
  mapStopReason,
  type OpenAIChatMessage,
  type OpenAIChatRequest,
  openAIChatToAnthropic,
  SYNTHESIZED_THINKING_LABEL,
  UpstreamErrorResponse,
} from "../providers/openai-translate.js";
export { withDefaultTarget } from "../providers/target-settings.js";
export {
  accountsReferencedByTargets,
  defaultTargetId,
  defaultTrustFor,
  listTargets,
  resolveModel,
  targetWarnings,
} from "../providers/targets.js";
export { buildContextLedger, readContextLedger, writeContextLedger } from "./context-ledger.js";
export { parseLimitPrediction, readLimitState, writeLimitState } from "./limit-prediction.js";
export {
  clearServedModel,
  readServedModel,
  writeServedModel,
  writeServedModelForTarget,
} from "./served-model.js";
export type { UpstreamDisplay, UpstreamDisplaySettings };
export {
  perGatewayEnvVar,
  type ResolvedUpstream,
  type ResolveResult,
  resolveActiveUpstream,
  resolveUpstreamDisplay,
};

import type {
  ContextBucket,
  ContextLedger,
  ContextToolsBlock,
  ToolOrigin,
} from "./context-ledger.js";

export type { ContextBucket, ContextLedger, ContextToolsBlock, ToolOrigin };

import type { LimitPrediction } from "./limit-prediction.js";

export { getContextGuard } from "./context-guard.js";
export { getContextMonitor, parseModelDescriptor } from "./context-monitor.js";
export { GolemProxy } from "./server.js";
export type {
  ProxyRequest,
  ProxyRoute,
  ProxyServerOptions,
  RequestPipeline,
  ResponseUsage,
  RouteResolver,
  UpstreamTranslator,
} from "./types.js";
export type { LimitPrediction };
