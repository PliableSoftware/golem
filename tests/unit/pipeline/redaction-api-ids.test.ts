/**
 * DUSTSEC.20 — the entropy sweep rewrote 33-character API object ids, and the
 * API rejects a placeholder in an id field. The exemption is the strict anchored
 * id shape only (`srvtoolu_` / `msgbatch_` + 24 base62, as the WHOLE token).
 *
 * Every value is built at runtime from a deterministic digest, so no key-shaped
 * literal is committed and the near-miss cases cannot flake. Each case runs on
 * all three paths that share `redactRequestBody`: the messages pipeline, the
 * generic JSON walker (count_tokens, batches) and the `redactOnly` fail-safe.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NativeLosslessCompression } from "../../../src/compression/index.js";
import { policyFor } from "../../../src/interfaces/policy.js";
import { createGolemPipeline, redactRequestBody } from "../../../src/pipeline/index.js";
import type { ProxyRequest } from "../../../src/proxy/types.js";
import { useTempDirs } from "../../helpers/tmp.js";

const ALPHABET = [
  [48, 57],
  [65, 90],
  [97, 122],
]
  .flatMap(([lo, hi]) =>
    Array.from({ length: (hi as number) - (lo as number) + 1 }, (_, i) =>
      String.fromCharCode((lo as number) + i),
    ),
  )
  .join("");

/** `n` deterministic base62 characters for `seed`. */
function base62(seed: string, n: number): string {
  let out = "";
  for (let i = 0; out.length < n; i++) {
    for (const b of createHash("sha256").update(`${seed}:${i}`).digest()) {
      if (b < 248 && out.length < n) out += ALPHABET[b % 62];
    }
  }
  return out;
}

const PLACEHOLDER_MARK = `[${"REDACTED"}:`;
const newTempDir = useTempDirs("golem-dustsec20-");

async function pipeline() {
  const projectDir = await newTempDir();
  return createGolemPipeline({
    compression: NativeLosslessCompression.forProjectDir(projectDir),
    policy: () => policyFor(1),
    projectId: projectDir,
  });
}

function req(url: string, body: unknown): ProxyRequest {
  return {
    method: "POST",
    url,
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify(body), "utf8"),
  };
}

/** The same string value placed in a body of each route shape. */
function bodies(value: string): { readonly name: string; readonly url: string; body: unknown }[] {
  const messages = [
    { role: "assistant", content: [{ type: "server_tool_use", id: value, name: "x", input: {} }] },
  ];
  return [
    { name: "messages", url: "/v1/messages", body: { model: "m", max_tokens: 1, messages } },
    { name: "count_tokens", url: "/v1/messages/count_tokens", body: { model: "m", messages } },
    {
      name: "batches",
      url: "/v1/messages/batches",
      body: { requests: [{ custom_id: "a", params: { model: "m", max_tokens: 1, messages } }] },
    },
    { name: "arbitrary", url: "/v1/other", body: { nested: [{ id: value }] } },
  ];
}

/** Every body the pipeline would forward for `value`, via process and via redactOnly. */
async function forwarded(value: string): Promise<{ via: string; text: string }[]> {
  const p = await pipeline();
  const out: { via: string; text: string }[] = [];
  for (const b of bodies(value)) {
    const request = req(b.url, b.body);
    const processed = await p.process(request);
    out.push({ via: `process ${b.name}`, text: (processed.body ?? Buffer.alloc(0)).toString() });
    const safe = (p.redactOnly as (r: ProxyRequest) => ProxyRequest)(request);
    out.push({ via: `redactOnly ${b.name}`, text: (safe.body ?? Buffer.alloc(0)).toString() });
  }
  return out;
}

async function expectSurvives(value: string): Promise<void> {
  for (const { via, text } of await forwarded(value)) {
    expect(text, via).toContain(JSON.stringify(value));
    expect(text, via).not.toContain(PLACEHOLDER_MARK);
  }
}

async function expectRedacted(value: string, leak: string = value): Promise<void> {
  for (const { via, text } of await forwarded(value)) {
    expect(text, via).not.toContain(leak);
    expect(text, via).toContain(PLACEHOLDER_MARK);
  }
}

describe("DUSTSEC.20 API object ids survive redaction", () => {
  for (const prefix of ["srvtoolu_", "msgbatch_"]) {
    it(`${prefix}<01 + 22 base62> is unchanged on every path`, async () => {
      for (let i = 0; i < 8; i++) {
        await expectSurvives(`${prefix}01${base62(`${prefix}${i}`, 22)}`);
      }
    });

    it(`${prefix}<01 + 22 base62> as a bare string value is unchanged (redactRequestBody)`, () => {
      for (let i = 0; i < 200; i++) {
        const id = `${prefix}01${base62(`${prefix}bare${i}`, 22)}`;
        expect(redactRequestBody({ id }).value).toEqual({ id });
        expect(redactRequestBody({ id }).count).toBe(0);
      }
    });
  }

  it("an id delimited by spaces inside prose survives; a secret beside it does not", () => {
    const id = `srvtoolu_01${base62("prose", 22)}`;
    const other = base62("beside", 40);
    const r = redactRequestBody({ t: `see ${id} and ${other} now` }).value as { t: string };
    expect(r.t).toContain(id);
    expect(r.t).not.toContain(other);
  });
});

describe("DUSTSEC.20 near-misses are STILL redacted", () => {
  const id = (prefix: string, n = 22) => `${prefix}01${base62(`nm:${prefix}:${n}`, n)}`;
  const noLead = (prefix: string) => `${prefix}${base62(`nm:nolead:${prefix}`, 24)}`;
  const cases: readonly (readonly [string, string])[] = [
    ["wrong prefix, id length", id("srvtoolv_")],
    ["srvtoolu_ without the documented 01 lead", noLead("srvtoolu_")],
    ["msgbatch_ without the documented 01 lead", noLead("msgbatch_")],
    ["uppercase prefix", id("SRVTOOLU_")],
    ["uppercase msgbatch prefix", id("MSGBATCH_")],
    ["bare toolu_ prefix at 33 chars", id("toolu_", 27)],
    ["srvtoolu_ one char short", id("srvtoolu_", 21)],
    ["srvtoolu_ one char long", id("srvtoolu_", 23)],
    ["msgbatch_ one char short", id("msgbatch_", 21)],
    ["msgbatch_ one char long", id("msgbatch_", 23)],
    ["container_ (no documented format, not exempt)", id("container_")],
    ["container_ at 32 chars", id("container_", 20)],
    ["id with a hyphen inside the 24", `srvtoolu_01${base62("h1", 9)}-${base62("h2", 12)}`],
    ["id with an underscore inside the 24", `msgbatch_01${base62("u1", 9)}_${base62("u2", 12)}`],
    ["id plus a real-looking secret appended", id("srvtoolu_") + base62("tail", 24)],
    ["id with a suffix after a hyphen", `${id("msgbatch_")}-${base62("sfx", 20)}`],
    ["id embedded in a longer token (leading char)", `x${id("srvtoolu_")}`],
    [
      "id embedded in a longer token (both sides)",
      `${base62("pre", 8)}${id("msgbatch_")}${base62("post", 8)}`,
    ],
    ["id joined to a key=value token", `id=${id("srvtoolu_")}`],
    ["a random 40-char secret in an id-named field", base62("secret40", 40)],
    ["a bearer-style token", base62("bearer", 48)],
    ["a 100-char base64-alphabet blob", `${base62("b64a", 98)}==`],
  ];

  for (const [name, value] of cases) {
    it(name, async () => {
      await expectRedacted(value);
    });
  }

  it("an AWS-style access key still redacts", async () => {
    const key = `AKIA${base62("aws", 16).toUpperCase()}`;
    await expectRedacted(key);
  });

  it("a bearer header value still redacts beside an id, and the id survives", () => {
    const id = `srvtoolu_01${base62("combo", 22)}`;
    const token = base62("bearer2", 48);
    const r = redactRequestBody({ t: `${id} Bearer ${token}` }).value as { t: string };
    expect(r.t).toContain(id);
    expect(r.t).not.toContain(token);
  });

  it("an id-named field holding a long secret is not exempt by field name", () => {
    const secret = base62("fieldname", 40);
    const body = { id: secret, tool_use_id: secret, custom_id: secret, container: { id: secret } };
    const r = redactRequestBody(body).value as typeof body;
    expect(JSON.stringify(r)).not.toContain(secret);
  });
});

describe("DUSTSEC.20 credential positions and delimiters", () => {
  const lead = (prefix: string, seed: string) => `${prefix}01${base62(seed, 22)}`;
  const noLead = (prefix: string, seed: string) => `${prefix}${base62(seed, 24)}`;
  const redact = (value: unknown) => JSON.stringify(redactRequestBody(value).value);

  // KNOWN RESIDUAL, not a feature: a value with the documented id shape (prefix,
  // 01 lead, 22 base62) is exempt wherever it is a whole token, including after
  // "Bearer " or in a credential header, because no built-in rule matches those
  // values and the sweep was their only protection. The lead keeps the residual
  // to shapes a real secret does not usually have.
  it("residual: a bearer-prefixed value in the exact id shape is NOT redacted", () => {
    const id = lead("srvtoolu_", "res1");
    expect(redact({ authorization: `Bearer ${id}` })).toContain(id);
    const batch = lead("msgbatch_", "res2");
    expect(redact({ authorization: `Bearer ${batch}` })).toContain(batch);
  });

  it("residual: an x-api-key header value in the exact id shape is NOT redacted", () => {
    const id = lead("msgbatch_", "res3");
    expect(redact({ headers: { "x-api-key": id } })).toContain(id);
  });

  it("the same credential positions WITHOUT the 01 lead ARE redacted", () => {
    const a = noLead("srvtoolu_", "nl1");
    const b = noLead("msgbatch_", "nl2");
    const c = noLead("msgbatch_", "nl3");
    expect(redact({ authorization: `Bearer ${a}` })).not.toContain(a);
    expect(redact({ authorization: `Bearer ${b}` })).not.toContain(b);
    expect(redact({ headers: { "x-api-key": c } })).not.toContain(c);
  });

  it("id then a dot then a secret: separate candidates, the secret is redacted", () => {
    const id = lead("srvtoolu_", "dot");
    const secret = base62("dotsecret", 40);
    const out = redactRequestBody({ t: `${id}.${secret}` }).value as { t: string };
    expect(out.t).toContain(id);
    expect(out.t).not.toContain(secret);
  });

  it("id then a colon then a secret: separate candidates, the secret is redacted", () => {
    const id = lead("msgbatch_", "colon");
    const secret = base62("colonsecret", 40);
    const out = redactRequestBody({ t: `${id}:${secret}` }).value as { t: string };
    expect(out.t).toContain(id);
    expect(out.t).not.toContain(secret);
  });

  it("an id followed by a newline is still a whole token and survives", () => {
    const id = lead("srvtoolu_", "nl");
    const out = redactRequestBody({ t: `${id}\nnext line` }).value as { t: string };
    expect(out.t).toBe(`${id}\nnext line`);
  });

  it("an id inside a URL path is still rewritten (embedded in a longer run)", () => {
    const id = lead("msgbatch_", "url1");
    expect(redact({ u: `https://example.test/v1/messages/batches/${id}` })).not.toContain(id);
  });

  it("an id as a query parameter value is still rewritten", () => {
    const id = lead("srvtoolu_", "url2");
    expect(redact({ u: `https://example.test/x?batch=${id}` })).not.toContain(id);
  });
});
