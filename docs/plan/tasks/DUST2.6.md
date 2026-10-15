---
task: DUST2.6
title: "Wiki rebaseline: configuration, team, portal, device auth and release pages"
state: done
owner: agent
size: M
discipline: write
design: "SUMMARY.md drift groups 'wiki: Configuration Surfaces / Device Authentication / Portal Install Contract / Project Team Binding / Release Pipeline / Settings Cascade / Team Layer' (:605-720); DECISIONS.md G2, G4, G5, P5, P6, X5, X9, X10, X11"
gate: "Every row listed below is fixed with code evidence; decided-but-unlanded behaviour (DUSTSEC.4, DUSTSEC.14) is described as decided with its task id, not as shipped; default-rule choices marked; golem wiki check green by exit code."
depends_on: [DUST2.1, DUSTSEC.16]
touches: [docs/wiki/concepts]
created: 2026-10-08
updated: 2026-10-08T12:19:10.571Z
---

## Rows

| page | rows | notes |
|---|---|---|
| `concepts/Configuration Surfaces.md` | 1.8/r021 (G26), r022 (G27), r024, r028 (G34) | G4/X9 duplicate runtime/setting rows ship; X10 `runtime:slider` → `runtime:compression`; X11 `parsePanelArgs` location; G5 panel default scope `project` (flag: D58(f) covers the CLI) |
| `concepts/Settings Cascade.md` | 1.8/r008, r009 | r009 + G2: invalid team value warns and skips (DUSTSEC.14) |
| `concepts/Team Layer.md` | 1.10/r054 | team origin is NOT applied on every load — say where it is; G3 is open (do not decide) |
| `concepts/Project Team Binding.md` | 1.10/r059 | P5: token bound to issuer origin, https only (DUSTSEC.4) |
| `concepts/Portal Install Contract.md` | 1.10/r068, r070 | |
| `concepts/Device Authentication.md` | 1.10/r035 | |
| `concepts/Release Pipeline.md` | 1.8/r067, r078, r079 | r073 (package name) is DUSTSEC.16's; X5 macOS advisory is the design; `cloudcatalyst/golem` → current org |

Also P6: document both edited-team-skill policies (portal removal keeps it, `unlink` removes it).

## Out of scope

- S17/P4 and G3 (open for the user). Code.

## Verification bar

`golem wiki check` green by exit code. Commit on your own branch.

## Outcome

shipped; fact-checked by sampling (58 claims), follow-ups in PR 240
