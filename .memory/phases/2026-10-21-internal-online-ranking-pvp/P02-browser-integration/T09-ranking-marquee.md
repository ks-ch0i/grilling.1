# Task: T09 상단 랭킹 전광판

## Status: done

## Goal
Town, Battle, PvP 화면의 상단에 stage/PvP 상위 5명과 현재 계정의 순위 변화를 번갈아 표시하고 SignalR 연결 복구를 제공한다.

## Decision Summary
- SignalR push가 기본이고 연결이 끊기면 60초 polling으로 현재 leaderboard snapshot을 다시 읽는다.
- SignalR Free의 단일 단위 20 concurrent connection과 20,000 messages/day 제한에 맞춰 board payload를 작고 이벤트 기반으로 유지한다.

## Implementation

### I01. RankingClient와 SignalR 연결
- Related Files:
  - package.json :: dependencies — @microsoft/signalr 추가; modify.
  - src/game/domain/rankingClient.js :: connect, subscribe, getSnapshot, dispose — API/SignalR client; new.
  - api/src/functions/signalr.js :: POST /api/signalr/negotiate — authenticated negotiate; new.
  - api/src/services/rankingEvents.js :: publishTopFiveChanged, publishPlayerRankChanged — group events; new.
  - api/src/functions/rankings.js :: GET /api/rankings/me — current account ranks; modify.
  - api/test/rankings/rankingEvents.test.js :: event payload and group routing; new.
- Details:
  - SignalR service mode is Serverless. negotiate endpoint requires Entra bearer identity and returns only its user-specific connection token.
  - Group names are ranking:stage and ranking:pvp. Each board group receives only top-five public rows without private save fields or player object IDs.
  - Event names: stageTopChanged and pvpTopChanged. Payload has board kind, immutable snapshot revision, top 5 public entries, generatedAtUtc.
  - GET /api/rankings/me returns { stage:{rank:number|null,chapter:number|null,stage:number|null,clearTimeMs:number|null}, pvp:{rank:number|null,rating:number} } for authenticated account. On a board event, client fetches this endpoint and compares with its cached rank to detect rank increases or decreases for that account.
  - RankingClient connects via negotiate, subscribes to each event, reconnects with bounded exponential backoff 1,2,4,8,16,30 seconds. While disconnected it polls top and me endpoints every 60 seconds; browser offline stops timers and next online event refreshes immediately.
  - On successful reconnect, fetch authoritative top-five and current ranks before marking state live. Poll response and event revision prevent stale snapshot overwrite.
  - Do not poll every open game tab more frequently than 60 seconds; no message is broadcast per movement, hit, or arbitrary save.

### I02. Scene overlay and readable rotation
- Related Files:
  - src/game/ui/RankingMarquee.js :: constructor, renderBoard, renderNotice, destroy — Phaser overlay; new.
  - src/game/scenes/TownScene.js :: create/renderTown — attach/unsubscribe; modify.
  - src/game/scenes/BattleScene.js :: create — attach/unsubscribe; modify.
  - src/game/scenes/PvpScene.js :: create — attach/unsubscribe; modify.
  - test/ranking-marquee.test.js :: rotation/empty/rank events; new.
- Details:
  - Position is fixed at x=640,y=24, width=1216, height=42, scrollFactor 0, depth 220. Town title/status header moves from y=18..45 to y=58..85; its panels and contents shift down 18px so the panels run y=110..612 with height 502 and preserve bottom actions at y=630. Battle/PvP HUD begins at y=60. The strip never covers buttons or health text.
  - Rotate stage and PvP top-five boards every 8 seconds; within each board list rows 1..5 in order. Show Korean empty-board message when no verified records exist.
  - On playerRankChanged, show a 5-second notice with board type and rank delta, then resume rotation. Do not show another account's private identifier.
  - Scene shutdown unsubscribes its UI observer only; singleton RankingClient remains connected until game disposal.

## Acceptance Criteria
- [x] Each gameplay scene shows the same marquee without duplicate SignalR connections.
- [x] Top-five event updates are immediate; reconnect/poll returns the latest snapshot.
- [x] Offline mode displays the last cached ranking and does not run network polling.
- [x] UI updates stay below Free message quota in the specified polling cadence and no event is sent per combat tick.

## Validation
    node --test test/ranking-marquee.test.js api/test/rankings/rankingEvents.test.js
    npm run build

## Commit Message
    feat(ranking-ui): add live top five marquee with polling recovery

    Plan: 2026-10-21-internal-online-ranking-pvp
    Phase: P02-browser-integration
    Task: T09-ranking-marquee

    - Rotate stage and PvP top five on every game scene
    - Recover authoritative ranking state after SignalR disconnects

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: e062d2c
