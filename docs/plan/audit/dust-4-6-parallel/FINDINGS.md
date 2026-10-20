# Dust skill dogfood 2: findings

Task DUST4.6, run 2026-10-20 from the `golem-dust` skill text. Covers what DUST4.4 left (its F10 and F11). Notes: `change-ledger-cli.md`, `change-ledger-store.md`; recount in `SUMMARY.md`.

| # | Defect in the skill text | What happened | Resolution |
|---|---|---|---|
| G1 | Nothing said row ids or file names must differ per partition, or how the notes meet | Two notes would collide if both used `W01` or one file name; the recount greps rows by id shape | Fixed: name each note for its partition, give ids a unique prefix |
| G2 | "Merge the notes" did not say the notes live on separate branches | The two branches merged cleanly only because the file names differed | Fixed: "merge the partition branches" |
| G3 | The recount had no method and no check | A note's own header was wrong (B: 6/3 against a true 7/2); a sum of headers would have been wrong | Fixed: one grep per class cell over all notes, counts must sum to the row count, the recount wins over a header |
| G4 | The skill names `golem task index --write` for generated files | In a repo with only `golem init` run it fails: `ENOENT ... docs/plan/ROADMAP.md` | Fixed: "for a Golem roadmap, where the project has one" |
| G5 | The skill names `golem verify` as the verify command | In the same repo it exits 1 with every check failed (exit 254, no `package.json`) | Fixed: Golem repo with package scripts, else the project's own |
| G6 | `/golem-park` is a Golem skill | `golem init` installs it (and `golem-verify`), so the reference holds | No change |
| G7 | "the project's audit directory if it has one" | The scratch repo has no `docs/`; the instruction still reads correctly | No change |
| G8 | Auditors truly in parallel | Not tested: one agent wrote both notes in turn | Open, stated in SUMMARY; needs two live agents |

Side effect of the scratch run: `golem init` started a proxy (pid 5751, port 5390). `golem uninit` removed the project wiring; the proxy process is not confirmed stopped.
