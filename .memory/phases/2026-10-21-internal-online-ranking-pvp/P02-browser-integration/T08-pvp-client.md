# Task: T08 PvP 클라이언트

## Status: pending

## Goal
마을에서 비동기 PvP를 시작하고 고정 상대 스냅샷과 전투해 서버 검증 결과·레이팅 변화·매칭 종료를 표시한다.

## Decision Summary
- 상대는 이동하지 않는 고정 위치의 공개 스냅샷이며, 플레이어의 몸통 접촉이 있으면 기존 양방향 contact 전투 규칙을 적용한다.
- PvP 입장과 제출은 온라인이어야 한다. 제한 시간은 60초이며 결과 레이팅은 서버 응답만 사용한다.

## Implementation

### I01. 매칭 진입과 PvPScene
- Related Files:
  - src/game/scenes/TownScene.js :: renderTown, startPvp — secondary PvP button and matchmaking; modify.
  - src/game/scenes/PvpScene.js :: init, create, update, handleContacts, finishMatch — dedicated battle scene; new.
  - src/game/config.js :: scene list — PvpScene registration; modify.
  - src/game/domain/pvpClient.js :: publishSnapshot, searchMatch, submitMatch — API adapter; new.
  - test/pvp/pvpClient.test.js :: matchmaking/offline/result cases; new.
- Details:
  - TownScene bottom action row becomes: previous-stage button x=32,y=630,w=188,h=58; stage label x=230,y=635,w=315; next-stage button x=560,y=630,w=190,h=58; stage start x=770,y=630,w=220,h=58; PvP button x=1010,y=630,w=238,h=58. Keep all buttons within 1280x720 and do not overlap the panels ending at y=612.
  - Before matchmaking, browser publishes current character/equipment snapshot from save revision. Search endpoint does not accept client rating or desired opponent identity.
  - On `no-opponent`, UI offers retry/cancel and shows current search window; on 401, reauth CTA; offline state disables PvP.
  - PvpScene receives MatchTicket with player snapshot, opponent snapshot, seed, simulatorVersion, expiry. Both are immutable for the match.
  - Opponent has no movement input or chase AI. It stays at fixed x position. Player input and existing `resolveContact` determine body-to-body damage exchanges; each contact breaks and reapplies on recontact.
  - Timer starts from ticket issue time contract and ends at 60 seconds. Browser records the player's inputs. It never submits locally computed winner, HP percentage, or rating.
  - Finish or timeout submits event log. Response fields: { outcome:'win'|'loss'|'draw', rated:boolean, playerRatingBefore:number, playerRatingAfter:number, opponentRatingAfter:number, remainingHpPercent:number }.
  - Result screen says if the match is unrated because of the daily pair rule. A server/network failure never changes displayed rating and offers return to TownScene.

### I02. Snapshot publication and tested transitions
- Related Files:
  - src/game/domain/accountSaveCoordinator.js :: after successful cloud save callback — publish changed character/equipment snapshot; modify.
  - test/pvp/pvpClient.test.js :: snapshot changes, duplicate submit, no network; modify.
- Details:
  - Publish only when canonical character/equipment snapshot hash differs from the last acknowledged revision. XP/material-only save changes do not trigger a snapshot revision unless they alter character stats.
  - A locally changed, not-yet-synced save does not become the rated server snapshot until cloud save succeeds.
  - On duplicate match result request, use matchId idempotency and display server stored result.

## Acceptance Criteria
- [ ] PvP can only start with an online ticket and a published server snapshot.
- [ ] Opponent movement AI is absent; existing contact combat is used.
- [ ] Server result alone controls winner, draw and rating display.
- [ ] one-pair-per-UTC-day rule is clearly shown when a later match is unrated.
- [ ] TownScene's existing gear and stage actions remain accessible.

## Validation
    node --test test/pvp/pvpClient.test.js
    node --test test/game-rules-simulation.test.js
    npm run build

## Commit Message
    feat(pvp): add snapshot based asynchronous match scene

    Plan: 2026-10-21-internal-online-ranking-pvp
    Phase: P02-browser-integration
    Task: T08-pvp-client

    - Add PvP matchmaking and immutable opponent snapshots
    - Show only server verified results and Elo changes

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
