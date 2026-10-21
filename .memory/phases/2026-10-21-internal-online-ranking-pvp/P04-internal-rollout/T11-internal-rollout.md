# Task: T11 사내 Azure 배포와 실환경 검증

## Status: pending

## Goal
승인된 사내 구독·resource group·region에 계획된 전용 리소스를 배포하고, 실제 Entra 접근과 API·저장·랭킹·PvP 경로를 사용자 계정으로 검증한다.

## Decision Summary
- 이 Task는 실제 비용이 발생할 수 있다. 현재 계획 작성만으로는 실행하지 않는다.
- 실행 전 사용자가 cost worksheet, target subscription/resource group, region, SQL vCore, SignalR Free 용량을 확인하고 명시적으로 진행 지시해야 한다.
- 기존 Azure 화면의 유사 Cosmos DB, Storage, Static Web App은 수정·재사용하지 않는다.

## Implementation

### I01. 승인 후 전용 리소스 배포
- Related Files:
  - infra/README.md :: selected deployment values — 최종 승인값 기록; modify.
  - infra/deployment-records/<date>.md :: resource IDs and what-if — 배포 기록; new.
  - .github/workflows/deploy-game.yml :: selected environment — frontend/API release; modify if approved.
- Details:
  - Precondition: 사용자가 승인한 subscription ID, resource group, region, SQL vCore, max size, tenant ID, SignalR tier/limits 및 cost worksheet가 채워져 있어야 한다. 누락되면 리소스를 만들지 않고 누락 항목을 보고한다.
  - Before create, re-run `az deployment group what-if`; 출력에서 existing resource deletion, replacement, or write가 보이면 중지한다.
  - Deploy only the new dedicated prefix. Apply SQL identity grants/firewall allowlist, run schema migration once, link Functions as the SWA BYO backend, configure Entra audience/tenant and SignalR connection setting, then publish frontend and API.
  - Store returned resource IDs, deployment timestamp, region, SKU/vCore, cost estimate source, Function outbound IP list, SWA URL, SignalR Free quota baseline in deployment record. Never write secrets or access tokens.

### I02. Internal E2E acceptance
- Related Files:
  - docs/internal-online-game-validation.md :: operator checklist and results; new.
  - test/e2e/internal-online-game.spec.js :: browser acceptance journey; new.
  - infra/deployment-records/<date>.md :: evidence references; modify.
- Details:
  - Verify anonymous/wrong-tenant access cannot call protected API, and a valid company account can sign in remotely over HTTPS without VPN.
  - Verify first account links the existing local save only when the cloud row is absent; second account gets a separate save; cloud-existing conflict restores cloud and preserves local backup.
  - Verify offline battle progress is saved locally and syncs after reconnect but does not change StageBests; offline PvP is blocked.
  - Verify valid online stage event trace updates stage best, manipulated event trace returns 422 and leaves score unchanged, equal-stage faster replay replaces the best, and slower replay does not.
  - Verify PvP starts from immutable snapshots, fixed opponent position, server replay result, HP-percent outcome, equal HP draw, two-sided Elo transaction, and second rated attempt against same opponent on UTC day leaves ratings unchanged.
  - Verify SignalR push changes marquee, forced disconnect recovers within the next 60-second poll, top five rotate, rank notice appears, and measured concurrent connections/messages stay within Free quota.
  - Capture logs/result codes and user-visible evidence without exporting tokens or private profile fields. Record NP/staging and production test identities distinctly.
  - If any real tenant/account result differs from local expected result, stop release and file the correlation ID; do not retry a stage/PvP result automatically.

## Acceptance Criteria
- [ ] Only the approved new resources are deployed and each has documented resource ID/SKU/location.
- [ ] All identity, save, offline, stage replay, PvP, leaderboard and SignalR acceptance paths pass in the target internal environment.
- [ ] SignalR Free quota remains within 20 connections and 20,000 messages/day during pilot validation.
- [ ] Secrets are absent from Git, screenshots, deployment records and test output.
- [ ] Results distinguish build/local evidence from actual target Azure E2E evidence.

## Validation
    npm run build
    npm --prefix api test
    node --test test/e2e/internal-online-game.spec.js
    az staticwebapp show --name <approved-swa-name> --resource-group <approved-resource-group>
    az functionapp show --name <approved-function-name> --resource-group <approved-resource-group>
    az sql db show --name <approved-database-name> --server <approved-sql-server> --resource-group <approved-resource-group>
    az signalr show --name <approved-signalr-name> --resource-group <approved-resource-group>

## Commit Message
    deploy(game): release internal online ranking pilot

    Plan: 2026-10-21-internal-online-ranking-pvp
    Phase: P04-internal-rollout
    Task: T11-internal-rollout

    - Deploy approved dedicated internal game resources
    - Validate Entra, saves, verified rankings, PvP and realtime boards

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
