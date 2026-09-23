/**
 * Context monitor for tracking request size relative to model context window.
 *
 * This module estimates the size of the request body (which includes the conversation history)
 * and compares it to the model's context window size to determine if the user should consider
 * compacting the conversation history (e.g., by summarizing it) to avoid exceeding the model's
 * context limit.
 *
 * It writes a small JSON file to `.golem/state/context-monitor.json` that the statusline can
 * read to display a warning.
 */

import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelDescriptor } from "../providers/gateways.ts";

/**
 * Configuration for the context monitor.
 */
export interface ContextMonitorConfig {
  /** Whether the context monitor is enabled. */
  enabled: boolean;
  /** Threshold ratio (0-1) at which to trigger a warning. */
  warningThreshold: number;
  /** Whether to log detailed debugging information. */
  debug: boolean;
}

/**
 * Default configuration for the context monitor.
 */
export const DEFAULT_CONTEXT_MONITOR_CONFIG: ContextMonitorConfig = {
  enabled: true,
  warningThreshold: 0.8, // Warn when request uses >80% of context window
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
  const match = input.match(/^(.+?)(?:\[(.+)\])?$/);
  let name: string;
  let contextSize: number | undefined;

  if (!match) {
    name = input;
  } else {
    const nameMatch = match[1];
    if (nameMatch === undefined) {
      // This should never happen because of the regex, but just in case.
      return { name: input };
    }
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

  if (contextSize !== undefined) {
    return { name, contextSize };
  }
  return { name };
}

/**
 * Context monitor instance that tracks the state for a single upstream connection.
 */
export class ContextMonitor {
  private config: ContextMonitorConfig;
  private contextSize: number | undefined; // Total context window size in tokens
  private requestSize: number = 0; // Estimated tokens in the request body

  constructor(config: Partial<ContextMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONTEXT_MONITOR_CONFIG, ...config };
    this.contextSize = undefined;
    this.requestSize = 0;
  }

  /**
   * Update the context size from a model descriptor (from gateway configuration).
   */
  setContextSizeFromDescriptor(descriptor: ModelDescriptor): void {
    if (descriptor.contextSize !== undefined) {
      this.contextSize = descriptor.contextSize;
      if (this.config.debug) {
        console.log(
          `[ContextMonitor] Set context size to ${this.contextSize} from model descriptor`,
        );
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
        console.log(`[ContextMonitor] Updated context size to ${this.contextSize} from headers`);
      }
      return true;
    }
    return false;
  }

  /**
   * Set the request size directly (in tokens).
   * This is called when we have an exact request size from headers or estimate.
   */
  setRequestSize(size: number): void {
    this.requestSize = size;
    if (this.config.debug) {
      console.log(`[ContextMonitor] Request size set to ${this.requestSize} tokens`);
    }
  }

  /**
   * Get the ratio of request size to context size.
   * Returns undefined if the context size is not known.
   */
  getUsageRatio(): number | undefined {
    if (this.contextSize === undefined || this.contextSize === 0) {
      return undefined;
    }
    return this.requestSize / this.contextSize;
  }

  /**
   * Check if the request size exceeds the warning threshold.
   * Returns true if the monitor is enabled and the usage ratio is greater than or equal to the warning threshold.
   */
  shouldWarn(): boolean {
    if (!this.config.enabled) {
      return false;
    }
    const ratio = this.getUsageRatio();
    if (ratio === undefined) {
      // If we don't know the context size, we cannot make a decision.
      return false;
    }
    return ratio >= this.config.warningThreshold;
  }

  /**
   * Get a debug string with the current state.
   */
  getDebugString(): string {
    const ratio = this.getUsageRatio();
    return `[ContextMonitor] enabled: ${this.config.enabled}, contextSize: ${this.contextSize ?? "unknown"}, requestSize: ${this.requestSize}, usageRatio: ${ratio ?? "unknown"}, warningThreshold: ${this.config.warningThreshold}`;
  }

  /**
   * Write the current state to a JSON file in .golem/state/context-monitor.json.
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
    const state = {
      contextSize: this.contextSize,
      requestSize: this.requestSize,
      usageRatio: this.getUsageRatio(),
      shouldWarn: this.shouldWarn(),
    };
    const stateFile = join(stateDir, "context-monitor.json");
    try {
      await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
      if (this.config.debug) {
        console.log(`[ContextMonitor] Wrote state to ${stateFile}`);
      }
    } catch (err) {
      if (this.config.debug) {
        console.error(`[ContextMonitor] Failed to write state file: ${err}`);
      }
    }
  }
}

/**
 * Singleton context monitor for the current proxy instance.
 * In a more complex setup, we might have one per upstream connection, but for now
 * we assume a single upstream per proxy instance.
 */
let contextMonitorInstance: ContextMonitor | null = null;

/**
 * Initialize or retrieve the context monitor singleton.
 */
export function getContextMonitor(config?: Partial<ContextMonitorConfig>): ContextMonitor {
  if (contextMonitorInstance === null) {
    contextMonitorInstance = new ContextMonitor(config);
  }
  return contextMonitorInstance;
}

/**
 * Reset the context monitor (e.g., when the upstream changes).
 */
export function resetContextMonitor(): void {
  contextMonitorInstance = null;
}
