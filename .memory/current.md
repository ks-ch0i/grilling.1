# Current Context

## Active Plan
[마창기사 벨트스크롤 웹게임](./plans/2026-09-26-lancer-belt-scroll-game.md)

## Active Phase
[P01 플레이 가능한 게임](./phases/2026-09-26-lancer-belt-scroll-game/P01-playable-game/phase.md)

## Active Task
[T02 게임 상태와 저장](./phases/2026-09-26-lancer-belt-scroll-game/P01-playable-game/T02-state-and-save.md)

## Status
- T01 completed on 2026-10-20: isolated Chromium confirmed the TownScene/title, landscape 16:9 layout, and unsupported portrait rotation notice; Node `22.12.0` build passed.
- The portrait notice now hides the game canvas; regression test passes. Existing save data was not accessed or changed.
- The 9/26 playable-game plan remains incomplete. The next active task is T02; later browser gameplay scenarios remain open.

## Next Step (IMPORTANT)
Read the active T02 blueprint and execute its state/schema and save/load checks. Use a clean isolated browser profile for persistence verification; preserve existing save data.
