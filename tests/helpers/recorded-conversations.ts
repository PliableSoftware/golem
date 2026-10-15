/**
 * Recorded request shapes for the level <= 1 fidelity suites (DUST2.24, r098).
 *
 * Each builder returns the messages of a Messages API conversation as the
 * client would resend them: the FULL history every turn, byte-identical to the
 * previous turn plus a new tail. That resend is exactly what prefix stability
 * is judged against. Secret-shaped values are built at runtime so no scanner
 * sees a literal and no placeholder passes vacuously.
 */

export type Msg = Record<string, unknown>;

export interface RecordedShape {
  readonly name: string;
  /** Top-level fields besides `messages`, in the order the client sent them. */
  readonly envelope: Readonly<Record<string, unknown>>;
  /** The conversation, one entry per message; turn k sends messages[0..k]. */
  readonly messages: readonly Msg[];
  /** Raw secret strings that must never reach the upstream wire. */
  readonly secrets: readonly string[];
  /** True when the shape repeats large tool output (level 1 may dedup it). */
  readonly hasDuplicates: boolean;
}

export const runtimeToken = (seed: string): string => `ghp_${seed.repeat(36)}`;

/** A log large enough to be a dedup candidate (>= 256 chars), trailing-whitespace free. */
export const BIG_LOG: string = Array.from(
  { length: 40 },
  (_, i) => `2026-10-08T00:00:${String(i).padStart(2, "0")}Z step ${i} ok`,
).join("\n");

const toolUse = (id: string, name = "Bash"): Msg => ({
  role: "assistant",
  content: [{ type: "tool_use", id, name, input: { command: "run" } }],
});
const toolResult = (id: string, content: unknown): Msg => ({
  role: "user",
  content: [{ type: "tool_result", tool_use_id: id, content }],
});

export function recordedShapes(): readonly RecordedShape[] {
  const token = runtimeToken("a");
  const dbPassword = `pw${"x9".repeat(8)}`;
  const connection = `${["postgres://app", dbPassword].join(":")}@db.internal:5432/main`;

  return [
    {
      name: "plain chat",
      envelope: { model: "claude-opus-5", max_tokens: 1024, system: "You are terse." },
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "what is 2+2?" },
        { role: "assistant", content: "4" },
      ],
      secrets: [],
      hasDuplicates: false,
    },
    {
      name: "tool loop with repeated large output (dedup candidate)",
      envelope: { model: "claude-opus-5", max_tokens: 4096, system: "Use tools." },
      messages: [
        { role: "user", content: "run the build" },
        toolUse("t1"),
        toolResult("t1", BIG_LOG),
        { role: "assistant", content: [{ type: "text", text: "ok, again" }] },
        { role: "user", content: "run it again" },
        toolUse("t2"),
        toolResult("t2", BIG_LOG),
        { role: "assistant", content: [{ type: "text", text: "same result" }] },
      ],
      secrets: [],
      hasDuplicates: true,
    },
    {
      name: "secret in early history plus repeated output",
      envelope: {
        model: "claude-opus-5",
        max_tokens: 4096,
        system: [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }],
      },
      messages: [
        { role: "user", content: `my token is ${token}` },
        { role: "assistant", content: "noted" },
        { role: "user", content: `connect with ${connection}` },
        toolUse("t1"),
        toolResult("t1", BIG_LOG),
        toolUse("t2"),
        toolResult("t2", BIG_LOG),
        { role: "assistant", content: "done" },
      ],
      secrets: [token, dbPassword],
      hasDuplicates: true,
    },
    {
      name: "whitespace-noisy log, thinking block, image, cache_control, unicode",
      envelope: {
        model: "claude-opus-5",
        max_tokens: 2048,
        temperature: 1.0,
        metadata: { user_id: "u-1" },
      },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "look ☃ 😀", cache_control: { type: "ephemeral" } }],
        },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm", signature: "c2lnbmF0dXJl" },
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
          ],
        },
        toolResult("t1", "a   \r\n\r\n\r\n\r\nb\t\n\n\n\nc   \n"),
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
            },
          ],
        },
        { role: "assistant", content: [{ type: "text", text: "seen" }] },
      ],
      secrets: [],
      hasDuplicates: false,
    },
  ];
}
