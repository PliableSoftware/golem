---
task: DUST2.25
title: "Fleet (P4): LAN worker reporting GPU/VRAM/load, hub capability table routing by tier, hub↔worker mTLS"
state: queued
owner: agent
size: L
discipline: code
design: "spec §2.2 and P4 (as rebaselined by DUST2.2); SUMMARY.md Gaps 1.6/r028 + 1.11/r013 (G22), 1.6/r029 (N), 1.6/r034 + 1.11/r026 (G21), 1.11/r023; DECISIONS.md X7, A9"
gate: "A LAN worker reports GPU/VRAM/load to the hub; the hub keeps a capability table and routes a job to the lowest tier meeting its minimum; hub↔worker traffic is mutually authenticated (mTLS); tests with a simulated worker. golem verify green by exit code."
blocked: "Needs a USER decision on whether fleet stays on the roadmap, and real multi-machine hardware for the live check."
touches: [src/inference, src/security, tests]
created: 2026-10-08
---

## What this is

Roadmap gap. Fleet is partial: device-surface mTLS ships (X7), worker reporting is partial,
hub routing and hub↔worker mTLS are not started.

## Hard rules

- No heavyweight native deps in the default install. Cross-platform.
- Tier thresholds follow code (`<8 / 8–16 / >16` GiB, A9) unless the user changes them.

## Out of scope

- Canary evals, per-device dashboard utilisation (spec register).

## USER decision, 2026-10-09

Parked: stays blocked on multi-machine hardware and is out of active planning. The spec already marks the fleet as mostly not built (`DECISIONS.md` FLEET).
