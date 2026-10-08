# HAFB kickoff prompt

Paste this as the first message in a fresh Claude Code session, started in an empty `hafb/` directory that already contains the `CLAUDE.md`.

---

Read CLAUDE.md in full before doing anything. It is the spec, the architecture, and the rules for this project. Do not start coding until you have.

We are building HAFB (Here's A Free Budget): a free, local-only, native Windows envelope-budgeting app whose goal is complete feature parity with YNAB. The non-negotiables in CLAUDE.md §1 are not up for debate — in particular: no network calls ever, money is integers in minor units, and all budget math lives in a pure TypeScript engine package with tests before UI.

Your job in this session is **Phase 0 only** (CLAUDE.md §7). Specifically:

1. **Plan first.** Before writing files, give me a short plan: the exact scaffold commands you'll run, the pnpm workspace layout you'll create (matching §3), and the four spike checks you'll build to prove the default stack (Tauri 2 + React + TypeScript + SQLite): (a) SQLite read/write through a Tauri command, (b) a virtualized grid holding 50,000 synthetic transaction rows that scrolls without jank, (c) a custom title bar where Windows snap layouts and Win+Arrow still work, (d) a `.msi` and portable `.exe` produced by `pnpm build`. Wait for my go-ahead on the plan.

2. **Scaffold the monorepo** per §3 with pnpm workspaces. `packages/engine` and `packages/shared` should exist with placeholder types for `Minor` money and `ISODate`/`Month` (§9) and a single passing Vitest test each, but **no budget logic yet**. `apps/desktop` is the Tauri app.

3. **Build the four spike checks** as throwaway screens behind a `/spike` route. Keep them ugly. They exist to be measured, not shipped.

4. **Set up the commands in §8** (`pnpm dev`, `pnpm test`, `pnpm test:engine`, `pnpm lint`, `pnpm build`) so they all work. `pnpm lint` must run tsc in strict mode with the flags listed in §9 plus eslint plus `cargo clippy`.

5. **Write `docs/decisions/0001-stack.md`** as an ADR: what was chosen, what was rejected and why (pull from §2), and a "spike results" section left blank for me to fill after I run it.

6. **Hand it to me for real-hardware validation.** End with a numbered list of exactly what I should do on my Windows PC: which command to run, which screen to open, what to look for, and what numbers to report back (frame timing from the grid spike, launch time, bundle size). I will run it and report results. Do not tell me it works; tell me how to check.

Constraints for this session:
- If a Tauri 2 / plugin / Rust toolchain version has changed since your training data, check the current docs before assuming an API. Say which version you targeted.
- Do not add any dependency beyond what the scaffold and the four spikes strictly need. List every dependency you add and confirm each makes no network calls at runtime.
- Do not touch budget features, YNAB import, or the schema. If you catch yourself designing categories or transactions, stop — that's Phase 1.
- If any spike check fails or looks marginal, say so plainly and propose the §2 fallback rather than papering over it.

When Phase 0 is validated on my machine, I'll update CLAUDE.md §7 and we'll start Phase 1 (the engine) in a new session.
