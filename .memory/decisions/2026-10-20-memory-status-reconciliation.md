# Decisions: Memory Status Reconciliation

- Date: 2026-10-20
- Status: Confirmed

## D01. Scope
- **Chosen**: Reconcile the three local plans in this repository: `2026-09-26-lancer-belt-scroll-game`, `2026-09-27-player-lethal-contact`, and `2026-09-28-game-balance`.
- **Excluded**: The deferred online ranking and asynchronous PvP design recorded in cross-session memory; it has no local plan and is not part of this cleanup.
- **Rationale**: Keep this work focused on the current repository's plan, phase, task, and pointer records.

## D02. Completion Evidence
- **Chosen**: Recheck each task's acceptance criteria and validation notes against current source, runnable checks, and browser checks when available. A prior `done` status, phase count, or Git commit alone does not confirm every acceptance criterion.
- **Chosen**: Record a commit hash only when Git history identifies the commit for that task.
- **Rationale**: The goal is to reconcile records with present evidence rather than repeat stale status claims.

## D03. Runtime for Validation
- **Chosen**: Run available build checks using the installed Node.js `20.19.4` without changing the machine-wide runtime. Record that `package.json` requires Node.js `>=22.12.0`; a pass on Node.js 20 does not establish a supported-runtime pass.
- **Rationale**: Revalidation is authorized, but changing the global Node installation is outside the selected scope.

## D04. Unverified Required Checks
- **Chosen**: Mark only verified checklist items complete. If a required manual browser check cannot be completed, leave that item unchecked and keep its task, phase, and parent plan incomplete.
- **Rationale**: Implementation status and unverified acceptance criteria must not be conflated.

## D05. Record Reconciliation
- **Chosen**: After evidence review, synchronize task status and progress, phase counts, parent plan status, matching Git commit references, and `.memory/current.md` with the resulting work state.
- **Rationale**: A single consistent record should show both completed validation and outstanding work.

## D06. Code Change Boundary
- **Chosen**: This reconciliation reviews code and validation evidence but does not change gameplay implementation. Report any newly discovered code defects separately for a later decision.
- **Rationale**: The requested work is to resolve memory records and status mismatches.
