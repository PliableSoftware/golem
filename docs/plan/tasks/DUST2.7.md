---
task: DUST2.7
title: "Wiki rebaseline: hosted sessions, transport, Buzz, personas, hooks, snooze and vibe pages"
state: done
owner: agent
size: M
discipline: write
design: "SUMMARY.md drift groups 'wiki: Buzz Integration / Guidance Rules / Hosted Session / Hosted-multi-turn-claude-CLI-spike / Persona Registry / Personal Vibe Guide / Plan Tasks / Session Transport / Spawn Headroom Gate' (:591-716); DECISIONS.md H1, R7, R9, G1"
gate: "Every row listed below is fixed with code evidence; docs/wiki/concepts/Usage Limit Park.md:33 and the Spawn Headroom Gate page say default false; decided-but-unlanded behaviour is attributed to its DUSTSEC task; golem wiki check green by exit code."
depends_on: [DUST2.1]
touches: [docs/wiki/concepts]
created: 2026-10-08
updated: 2026-10-08T12:19:11.117Z
---

## Rows

| page | rows | notes |
|---|---|---|
| `concepts/Usage Limit Park.md` | H1 | `:33` says `snooze.enforce` default **true**; code is false (`src/config/schema.ts:1197`, USER 2026-09-25) |
| `concepts/Spawn Headroom Gate.md` | 1.7/r002, r008 | `spawn_gate` default false (`schema.ts:1198`) |
| `concepts/Hosted Session.md` | 1.10/r019, r039, r040 | |
| `concepts/Hosted-multi-turn-claude-CLI-spike.md` | 1.6/r021 | |
| `concepts/Session Transport.md` | 1.10/r023, r024 | |
| `concepts/Buzz Integration.md` | 1.10/r074, r078 | note R14.2 is gated on DUSTSEC.6 |
| `concepts/Persona Registry.md` | 1.6/r008, r013, r019 | R9: owner:user refused by the worker lane (DUSTSEC.11); G1 `worker_targets` live (DUSTSEC.13 documents precedence — coordinate, do not duplicate) |
| `concepts/Personal Vibe Guide.md` | 1.8/r052 | R7: `sources.json`/`candidates.jsonl` redacted (DUSTSEC.9) |
| `concepts/Guidance Rules.md` | 1.7/r023 | |
| `concepts/Plan Tasks.md` | 1.7/r028 | H2 (`blocked` state vs metadata) is open — describe both, do not decide |

## Out of scope

- Implementing hosted-session gaps (DUST2.19). Spec D45 note (DUST2.2).

## Verification bar

`golem wiki check` green by exit code. Commit on your own branch.

## Outcome

shipped; fact-checked by sampling (58 claims), follow-ups in PR 240
