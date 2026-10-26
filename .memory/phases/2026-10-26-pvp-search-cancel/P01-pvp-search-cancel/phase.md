# Phase P01: 비동기 PvP 검색 취소

## Goal
검색 상태를 서버에 보관하고, 검색 시작·취소·상태 확인·전투 시작 경계를 한 SearchId로 추적한다. 검색 취소는 검색 loop와 아직 시작되지 않은 issued 티켓까지 종료하며, PvpScene 시작과 transaction 경합으로 보호한다.

## Status: in_progress

## Tasks
| Task | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01-T01 | done | 검색 상태 테이블, match started 상태와 transaction repository 경계를 추가한다. | [T01](./T01-search-state-schema.md) |
| P01-T02 | done | 검색 lifecycle 서비스와 인증된 시작·상태·취소·시작 API를 구현한다. | [T02](./T02-search-lifecycle-api.md) |
| P01-T03 | done | SearchId 멱등 클라이언트와 검색 취소 overlay, 서버 시작 확인을 연결한다. | [T03](./T03-search-cancel-client.md) |
| P01-T04 | planned | terminal 검색 row를 기존 일일 retention 작업에서 제한된 batch로 삭제한다. | [T04](./T04-search-retention-cleanup.md) |

## Dependencies
- T01 precedes T02 and T04 because both consume the new search-state schema and repository methods.
- T02 precedes T03 because the client contract depends on the authenticated API response and state names.
- T04 follows T01; it is sequenced last so earlier tasks first establish terminal-state transitions and retention timestamps.

## Phase Acceptance
- 같은 검색 ID를 반복 전송해도 검색 loop와 발급 ticket은 각각 최대 하나다.
- 취소가 start보다 먼저 commit되면 issued match는 expired가 되고 결과/rating 반영이 거부된다. start가 먼저 commit되면 취소는 거부된다.
- 검색 대기 화면은 취소 확정까지 유지되고, 응답 유실 뒤 같은 ID로 상태를 재확인할 수 있다.
- PvpScene이 시작 확인을 받기 전에는 simulation 또는 result submission을 시작하지 않는다.
- terminal search row는 RetainUntilUtc 이후 cleanup 대상이 되고, cleanup은 기존 10 batch 전체 한도를 공유한다.

## Validation
- 상세 명령과 acceptance checks는 각 Task 청사진에 있다.
- 구현 계획 작성 시 소스 테스트·build·DB migration은 실행하지 않는다.
