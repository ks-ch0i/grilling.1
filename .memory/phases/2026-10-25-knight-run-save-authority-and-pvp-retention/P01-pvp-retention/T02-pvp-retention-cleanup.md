# Task: T02 PvP payload 정리 timer

## Status: done

## Goal
하루 한 번 UTC 기준으로 terminal match의 90일 경과 replay payload와 오늘 이전의 rated pair-day row를 제한된 batch로 정리한다. history summary와 아직 유효한 ticket payload는 삭제하지 않는다.

## Decision Summary
- Azure Functions v4 `app.timer`를 사용하고 별도 timer 패키지는 추가하지 않는다.
- cleanup은 멱등적이며 invocation당 최대 10개 batch, batch당 최대 500행으로 제한한다.

## Implementation

### I01. Repository cleanup과 timer handler

- Related Files:
  - `api/src/repositories/pvpRetentionRepository.js` :: `expireOverdueIssuedMatchesBatch`, `deleteExpiredPayloadBatch`, `deleteOldRatedPairDayBatch`; new
  - `api/src/services/pvpRetentionService.js` :: `cleanupPvpRetention`; new
  - `api/src/functions/pvpRetentionCleanup.js` :: timer registration; new
  - `api/src/index.js` :: retention timer 등록; modify
  - `api/host.json` :: 현재 route prefix 외 설정 변경 불필요; read-only

#### Details
- **Signatures & Types**:
  ```js
  expireOverdueIssuedMatchesBatch(transaction, {nowUtc, batchSize}) -> Promise<number>
  deleteExpiredPayloadBatch(transaction, {nowUtc, batchSize}) -> Promise<number>
  deleteOldRatedPairDayBatch(transaction, {nowUtc, batchSize}) -> Promise<number>
  cleanupPvpRetention(pool, {clock, withTransaction, repository, batchSize=500, maxBatches=10}) -> Promise<{payloadRowsDeleted:number, pairDayRowsDeleted:number, batches:number}>
  ```
- **Data & Schema Fields**:
  - payload 만료 조건: match status in `completed|rejected|expired`, terminal time `COALESCE(CompletedAtUtc, ExpiresAtUtc) <= DATEADD(day,-90,@NowUtc)`.
  - pair-day 조건: `MatchDateUtc < CONVERT(date,@NowUtc)`. 오늘 UTC 날짜 row는 현재 rated 1일 제한에 필요하므로 보존한다.
- **Execution Flow / Logic**:
  1. 새 function `app.timer('pvpRetentionCleanup', { schedule:'0 15 3 * * *', runOnStartup:false, useMonitor:true, handler })`를 등록한다.
  2. handler는 연결 pool을 얻고 현재 UTC 시각을 한 번 고정해 service에 전달한다. 실패는 Functions runtime이 재시도할 수 있도록 throw하고, 성공 시 삭제 건수만 구조 로그에 남긴다.
  3. 먼저 `Status='issued' AND ExpiresAtUtc <= @NowUtc`를 batch 단위로 `expired`로 바꾼다. 기존 `ExpiresAtUtc`가 terminal 기준이므로 `CompletedAtUtc`는 설정하지 않는다.
  4. 각 repository 호출은 `DELETE TOP (@BatchSize)` 또는 `UPDATE TOP (@BatchSize)` 후 `@@ROWCOUNT`를 반환한다. service는 단계별 최대 `maxBatches`회 반복하고 0행이면 중단한다.
  5. 각 batch는 짧은 transaction으로 실행한다. 이미 변경된 행은 다음 호출에서 0건이므로 timer 재실행은 안전하다.
  6. 한 번의 invocation이 상한에 도달해 남은 행이 있어도 다음 날 계속 처리한다. 실행 시간을 무제한으로 늘리지 않는다.
- **Error & Exception Handling**: DB 오류를 삼키지 않는다. payload delete가 실패해도 다음 invocation에서 재실행 가능하다. 현재 UTC 날짜 pair row는 어떤 경우에도 delete 조건에 들어가지 않는다.
- **State Transition & Return**: 요약 `PvpMatches`는 delete하지 않는다. 아직 issued이며 만료 전인 match payload도 delete하지 않는다.

### I02. Timer/repository 테스트

- Related Files:
  - `api/test/pvp/pvpRetentionRepository.test.js` :: SQL predicates/batch bounds; new
  - `api/test/pvp/pvpRetentionService.test.js` :: 반복·상한·재실행; new
  - `api/test/pvp/pvpRetentionFunction.test.js` :: timer 설정/handler; new

#### Details
- 테스트 시각을 고정해 89일 23시간, 정확히 90일, 90일 초과 경계를 검사한다.
- issued match의 `ExpiresAtUtc`가 미래면 상태와 payload가 보존된다. 만료된 issued match는 먼저 expired 상태가 된 뒤 90일을 더 보관하고 이후 payload 정리 대상이 된다.
- pair-day의 전날은 대상이고 오늘은 제외된다.
- batch가 0행이면 즉시 종료, batch가 계속 가득 차도 `maxBatches` 이후 중단한다.
- timer는 `runOnStartup:false`, UTC cron, `useMonitor:true`로 등록된다.

## Acceptance Criteria
- [x] timer가 UTC 매일 03:15에 등록되고 시작 시 자동 실행되지 않는다.
- [x] payload 90일 보관과 현재 UTC pair 제한을 모두 만족한다.
- [x] invocation별 삭제량이 설정 상한 안에 있고 반복 실행해도 안전하다.
- [x] 요약 match 행과 issued 만료 전 payload를 삭제하지 않는다.

## Validation
- `node --test test/pvp/pvpRetentionRepository.test.js test/pvp/pvpRetentionService.test.js test/pvp/pvpRetentionFunction.test.js` (workdir: `api`) — cleanup 테스트 통과
- `npm test` (workdir: `api`) — API 전체 테스트 통과
- `npm run check` (workdir: `api`) — Function entry syntax 확인

## Commit Message
```text
feat(pvp): schedule bounded replay payload cleanup

Plan: 2026-10-25-knight-run-save-authority-and-pvp-retention
Phase: P01-pvp-retention
Task: T02-pvp-retention-cleanup

- Purge terminal replay payloads after 90 days
- Keep current-day rated limits and match summaries intact
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- Validation: focused cleanup tests 12 passed; API suite 116 passed; Function entry check passed.
- commit: 8a78e39
