# Plan: Player Lethal Contact

## Goal
Ensure lethal incoming contact damage reduces player HP to zero even when the same contact defeats the enemy, and route the attempt to the existing game-over flow before enemy defeat or stage-clear rewards can be processed.

## Phases
| Phase | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01 | `done ✅` | Source, domain, and lethal/nonlethal browser scenarios verified. | [P01](../phases/2026-09-27-player-lethal-contact/P01-lethal-contact/phase.md) |

> 2026-10-20 completion: P01 is done 1/1. Isolated Chromium confirmed a lethal killing contact enters game over without kill rewards and a nonlethal killing contact awards XP normally.
