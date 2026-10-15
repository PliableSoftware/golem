// Child-process writer for the cross-process host-log rotation test.
import { appendHostLog } from "../../src/session/host-log.js";

const [dir, tag, count, maxBytes] = process.argv.slice(2) as [string, string, string, string];
for (let i = 0; i < Number(count); i += 1) {
  await appendHostLog(
    dir,
    {
      kind: "turn",
      ts: "2026-10-09T00:00:00.000Z",
      sessionId: "s",
      origin: tag,
      text: `${tag}-${i} ${"x".repeat(40)}`,
    },
    { maxBytes: Number(maxBytes), keep: 10_000 },
  );
}
