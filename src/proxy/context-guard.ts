/**
 * Context guard for tracking model context usage and triggering pre-emptive compaction.
 *
 * This module estimates the remaining context window size based on:
 *   - The configured context size (from gateway model descriptor or upstream headers)
 *   - The token usage of requests and responses (estimated or from headers)
 *
 * When the remaining tokens fall below a safety margin, it signals that compaction
 * should be considered to avoid exceeding the model's context limit.
 */

import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelDescriptor } from "../providers/gateways.ts";

/**
 * Configuration for the context guard.
 */
export interface ContextGuardConfig {
  /** Whether the context guard is enabled. */
  enabled: boolean;
  /** Safety margin of tokens to keep unused before triggering compaction. */
  safetyMargin: number;
  /** Whether to log detailed debugging information. */
  debug: boolean;
}

/**
 * Default configuration for the context guard.
 */
export const DEFAULT_CONTEXT_GUARD_CONFIG: ContextGuardConfig = {
  enabled: true,
  safetyMargin: 2048, // Keep 2K tokens free by default
  debug: false,
};

/**
 * Estimate the number of tokens in a text string using the same rough heuristic
 * as the brevity stage (chars/4).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract token usage from upstream response headers if available.
 * Returns the number of tokens used in the response (completion tokens) or undefined.
 */
export function extractResponseTokenUsage(headers: Record<string, string>): number | undefined {
  // Look for known headers that indicate token usage
  const completionTokenHeaders = [
    "x-ratelimit-remaining-tokens", // Not standard, but some providers might use
    "anthropic-ratelimit-remaining-tokens",
    "openai-token-usage-completion", // Hypothetical
    "x-token-usage-completion",
  ];
  for (const hdr of completionTokenHeaders) {
    const val = headers[hdr];
    if (val !== undefined) {
      const num = parseInt(val, 10);
      if (!Number.isNaN(num)) {
        return num;
      }
    }
  }
  return undefined;
}

/**
 * Extract the remaining tokens in the context window from upstream headers.
 * Returns the number of tokens remaining or undefined.
 */
export function extractContextRemaining(headers: Record<string, string>): number | undefined {
  const remainingHeaders = [
    "anthropic-ratelimit-remaining-tokens",
    "x-ratelimit-remaining-tokens",
    "openai-ratelimit-remaining-tokens",
  ];
  for (const hdr of remainingHeaders) {
    const val = headers[hdr];
    if (val !== undefined) {
      const num = parseInt(val, 10);
      if (!Number.isNaN(num)) {
        return num;
      }
    }
  }
  return undefined;
}

/**
 * Extract the total context window size from upstream headers.
 * Returns the context size in tokens or undefined.
 */
export function extractContextSizeFromHeaders(headers: Record<string, string>): number | undefined {
  const sizeHeaders = [
    "anthropic-ratelimit-limit-tokens",
    "x-ratelimit-limit-tokens",
    "openai-ratelimit-limit-tokens",
  ];
  for (const hdr of sizeHeaders) {
    const val = headers[hdr];
    if (val !== undefined) {
      const num = parseInt(val, 10);
      if (!Number.isNaN(num)) {
        return num;
      }
    }
  }
  return undefined;
}

/**
 * Parse a model descriptor string to extract the model name and optional context size.
 * Expected format: "name[contextSize]" where contextSize is an integer (e.g., "model[262k]" -> 262000).
 * The context size can be specified in raw tokens or with a suffix (k for thousand).
 */
export function parseModelDescriptor(input: string): ModelDescriptor {
  let name: string = input;
  let contextSize: number | undefined;

  const match = input.match(/^(.+?)(?:\[(.+)\])?$/);
  if (match) {
    const nameMatch = match[1];
    if (nameMatch !== undefined) {
      name = nameMatch;
      if (match[2] !== undefined) {
        const num = parseFloat(match[2]);
        if (!Number.isNaN(num)) {
          const lower = match[2].toLowerCase();
          if (lower.endsWith("k")) {
            contextSize = num * 1000;
          } else if (lower.endsWith("m")) {
            contextSize = num * 1000000;
          } else {
            contextSize = num;
          }
        }
      }
    }
  }

  if (contextSize !== undefined) {
    return { name, contextSize };
  }
  return { name };
}

/**
 * Context guard instance that tracks the state for a single upstream connection.
 */
export class ContextGuard {
  private config: ContextGuardConfig;
  private contextSize: number | undefined; // Total context window size in tokens
  private usedTokens: number = 0; // Estimated tokens used so far in the window

  constructor(config: Partial<ContextGuardConfig> = {}) {
    this.config = { ...DEFAULT_CONTEXT_GUARD_CONFIG, ...config };
    this.contextSize = undefined;
    this.usedTokens = 0;
  }

  /**
   * Update the context size from a model descriptor (from gateway configuration).
   */
  setContextSizeFromDescriptor(descriptor: ModelDescriptor): void {
    if (descriptor.contextSize !== undefined) {
      this.contextSize = descriptor.contextSize;
      if (this.config.debug) {
        console.log(`[ContextGuard] Set context size to ${this.contextSize} from model descriptor`);
      }
    }
  }

  /**
   * Update the context size from upstream headers (if available).
   * @returns true if the context size was updated from headers
   */
  updateContextSizeFromHeaders(headers: Record<string, string>): boolean {
    const headerSize = extractContextSizeFromHeaders(headers);
    if (headerSize !== undefined) {
      this.contextSize = headerSize;
      if (this.config.debug) {
        console.log(`[ContextGuard] Updated context size to ${this.contextSize} from headers`);
      }
      return true;
    }
    return false;
  }

  /**
   * Update the used token count from upstream headers (if available).
   * @returns true if the used tokens were updated from headers
   */
  updateUsedTokensFromHeaders(headers: Record<string, string>): boolean {
    const remaining = extractContextRemaining(headers);
    if (remaining !== undefined && this.contextSize !== undefined) {
      this.usedTokens = this.contextSize - remaining;
      if (this.config.debug) {
        console.log(`[ContextGuard] Used tokens: ${this.usedTokens} (remaining: ${remaining})`);
      }
      return true;
    }
    return false;
  }

  /**
   * Estimate and add token usage from a request and response.
   * This is used when headers do not provide token usage information.
   */
  addTokenUsage(request: string, response: string): void {
    const requestTokens = estimateTokens(request);
    const responseTokens = estimateTokens(response);
    this.usedTokens += requestTokens + responseTokens;
    if (this.config.debug) {
      console.log(
        `[ContextGuard] Added ${requestTokens + responseTokens} tokens (req: ${requestTokens}, resp: ${responseTokens}). Total used: ${this.usedTokens}`,
      );
    }
  }

  /**
   * Get the remaining tokens in the context window.
   * Returns undefined if the context size is not known.
   */
  getRemaining(): number | undefined {
    if (this.contextSize === undefined) {
      return undefined;
    }
    return Math.max(0, this.contextSize - this.usedTokens);
  }

  /**
   * Check if compaction should be triggered based on remaining tokens and safety margin.
   * Returns true if the guard is enabled and remaining tokens are less than or equal to the safety margin.
   */
  shouldCompact(): boolean {
    if (!this.config.enabled) {
      return false;
    }
    const remaining = this.getRemaining();
    if (remaining === undefined) {
      // If we don't know the context size, we cannot make a decision.
      return false;
    }
    return remaining <= this.config.safetyMargin;
  }

  /**
   * Get a debug string with the current state.
   */
  getDebugString(): string {
    const remaining = this.getRemaining();
    return `[ContextGuard] enabled: ${this.config.enabled}, contextSize: ${this.contextSize ?? "unknown"}, usedTokens: ${this.usedTokens}, remaining: ${remaining ?? "unknown"}, safetyMargin: ${this.config.safetyMargin}`;
  }

  /**
   * Get the current state as a plain object for serialization.
   */
  getState() {
    return {
      contextSize: this.contextSize,
      usedTokens: this.usedTokens,
      remaining: this.getRemaining(),
      safetyMargin: this.config.safetyMargin,
      shouldCompact: this.shouldCompact(),
    };
  }

  /**
   * Write the current state to a JSON file in .golem/state/context-guard.json.
   * This file is read by the statusline to display a warning.
   */
  async writeStateFile(projectDir: string): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    const stateDir = join(projectDir, ".golem", "state");
    try {
      await access(stateDir);
    } catch {
      await mkdir(stateDir, { recursive: true });
    }
    const state = this.getState();
    const stateFile = join(stateDir, "context-guard.json");
    try {
      await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
      if (this.config.debug) {
        console.log(`[ContextGuard] Wrote state to ${stateFile}`);
      }
    } catch (err) {
      if (this.config.debug) {
        console.error(`[ContextGuard] Failed to write state file: ${err}`);
      }
    }
  }
}

/**
 * Singleton context guard for the current proxy instance.
 * In a more complex setup, we might have one per upstream connection, but for now
 * we assume a single upstream per proxy instance.
 */
let contextGuardInstance: ContextGuard | null = null;

/**
 * Initialize or retrieve the context guard singleton.
 */
export function getContextGuard(config?: Partial<ContextGuardConfig>): ContextGuard {
  if (contextGuardInstance === null) {
    contextGuardInstance = new ContextGuard(config);
  }
  return contextGuardInstance;
}

/**
 * Reset the context guard (e.g., when the upstream changes).
 */
export function resetContextGuard(): void {
  contextGuardInstance = null;
}
