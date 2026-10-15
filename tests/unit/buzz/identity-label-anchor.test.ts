/**
 * DUSTSEC.18 — the keygen label match is anchored to the label at line start,
 * so a curve name like `secp256k1` in a public-key line is not a secret label.
 * Key values are built at runtime; the guarantee under test is that no input
 * yields the secret as the pubkey.
 */

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseGenerateKeyOutput } from "../../../src/buzz/identity.js";

const S = randomBytes(32).toString("hex");
const P = randomBytes(32).toString("hex");

describe("parseGenerateKeyOutput: label anchored to line start", () => {
  it("a curve name in a public-key line does not count as a secret label", () => {
    expect(
      parseGenerateKeyOutput(`public key (secp256k1): ${P}\nsecret key (secp256k1): ${S}\n`),
    ).toEqual({ pubkeyHex: P, secretHex: S });
  });

  it("secret first, curve name on both lines", () => {
    expect(
      parseGenerateKeyOutput(`Secret key (secp256k1): ${S}\nPublic key (secp256k1): ${P}`),
    ).toEqual({
      pubkeyHex: P,
      secretHex: S,
    });
  });

  it("indented and bulleted labels still classify", () => {
    expect(parseGenerateKeyOutput(`  - pubkey: ${P}\n  - seckey: ${S}\n`)).toEqual({
      pubkeyHex: P,
      secretHex: S,
    });
  });

  it("a hex line whose label is not at its start is unclassifiable, never guessed", () => {
    expect(() => parseGenerateKeyOutput(`key: public ${P}\nkey: secret ${S}\n`)).toThrow(
      /ambiguous/,
    );
  });

  it.each([
    `public key (secp256k1): ${S}\nsecret key (secp256k1): ${S}\n`,
    `secret key (secp256k1): ${S}\n${P}\n`,
    `pubkey=${P} secret=${S}\n`,
    `secret: ${S} (public: ${P})\n`,
  ])("never returns the secret as the pubkey: %#", (out) => {
    let pubkey: string | undefined;
    try {
      pubkey = parseGenerateKeyOutput(out).pubkeyHex;
    } catch {
      // refusing is fine
    }
    expect(pubkey).not.toBe(S);
  });
});
