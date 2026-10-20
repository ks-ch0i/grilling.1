# Plan: Memory Status Reconciliation

## Goal

Recheck the acceptance criteria and validation records in the three existing local plans, then reconcile task, phase, parent-plan, commit-reference, and `.memory/current.md` state with current evidence. Only verified checklist items are marked complete. Required manual checks that cannot be completed remain unchecked and keep their original task, phase, and plan incomplete.

## Scope and Constraints

- In scope: `2026-09-26-lancer-belt-scroll-game`, `2026-09-27-player-lethal-contact`, and `2026-09-28-game-balance`.
- Out of scope: online ranking/PvP cross-session notes and all gameplay implementation changes.
- The installed runtime is Node.js `20.19.4`; `package.json` requires `>=22.12.0`. Run available checks without changing the machine-wide runtime and record this limitation. A passing build on Node 20 is not a supported-runtime pass.
- Use a clean browser profile or otherwise isolated browser origin for manual gameplay checks; do not clear or overwrite existing game saves.
- Do not add test files. Use existing Node assertion commands, source review, the Vite build, and browser checks.

## Phases

| Phase | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01 | `done` | Audit evidence reconciled; historical plans remain open only for outstanding validation | [P01](../phases/2026-10-20-memory-status-reconciliation/P01-evidence-and-records/phase.md) |

## Task Order

| Task | Scope | Files |
| :--- | :--- | :--- |
| T01 | Revalidate the 9/26 playable-game plan and reconcile its seven task records | `.memory/plans/2026-09-26-lancer-belt-scroll-game.md`, its P01 phase and T01–T07; app/domain/scene source read-only |
| T02 | Revalidate lethal-contact behavior and reconcile its task/phase/plan records | `.memory/plans/2026-09-27-player-lethal-contact.md`, its P01 phase and T01; combat/BattleScene/progression source read-only |
| T03 | Revalidate balance, upgrade, and town-feedback behavior and reconcile its records | `.memory/plans/2026-09-28-game-balance.md`, its P01 phase and T01–T03; balance/gear/TownScene source read-only |
| T04 | Cross-check all reconciled records and set the final current pointer | `.memory/current.md` and the three plans/phases/tasks |

## Completion Rules

- A task is `done` only when its required acceptance criteria and validation are confirmed. Record command, browser, or source evidence in that task's Validation/Progress area.
- If a required manual check cannot be completed, leave its checklist item unchecked, set that original task to `in_progress`, and propagate incomplete progress to its phase and plan.
- Populate original commit fields only with the matching commit found in Git history; do not use the reconciliation commit as the implementation commit.
- Final `.memory/current.md` points to the oldest original task that still has required validation outstanding. If none remain, it points to this reconciliation plan as complete and says there is no remaining task.

## Implementation Boundary

This plan changes `.memory/` records only. If validation exposes a gameplay defect, capture the evidence and report it separately for a later implementation decision.
