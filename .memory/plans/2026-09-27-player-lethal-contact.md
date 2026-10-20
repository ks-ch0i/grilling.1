# Plan: Player Lethal Contact

## Goal
Ensure lethal incoming contact damage reduces player HP to zero even when the same contact defeats the enemy, and route the attempt to the existing game-over flow before enemy defeat or stage-clear rewards can be processed.

## Phases
| Phase | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01 | `in_progress` | Source and domain check passed; browser lethal/nonlethal scenarios remain unverified. | [P01](../phases/2026-09-27-player-lethal-contact/P01-lethal-contact/phase.md) |

> 2026-10-20 status audit: the deterministic domain result and source ordering match the confirmed 9/27 decision; required browser outcomes were unavailable, so P01 remains `done: 0/1`.
