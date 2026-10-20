# Current Context

## Active Plan
[마창기사 벨트스크롤 웹게임](./plans/2026-09-26-lancer-belt-scroll-game.md)

## Active Phase
[P01 플레이 가능한 게임](./phases/2026-09-26-lancer-belt-scroll-game/P01-playable-game/phase.md)

## Active Task
[T01 Vite와 Phaser 앱 뼈대](./phases/2026-09-26-lancer-belt-scroll-game/P01-playable-game/T01-app-shell.md)

## Status
- The 2026-10-20 reconciliation audit is complete. The oldest remaining task is 9/26 T01; historical plans remain incomplete where checks are still open.
- In a clean isolated browser, verify the current TownScene/title, landscape 16:9 layout, and portrait rotation prompt. Browser access was unavailable in the audit session; do not clear or overwrite existing saves.
- `npm run build` passed on Node `20.19.4`, but `package.json` requires `>=22.12.0`; supported-engine build validation remains open.

## Next Step (IMPORTANT)
Run the app with `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort` in a clean isolated browser profile. Verify the current town screen, landscape 16:9 sizing, and portrait rotate prompt; also rerun `npm run build` under Node `>=22.12.0`. Leave all unavailable checks open and do not touch existing save data.
