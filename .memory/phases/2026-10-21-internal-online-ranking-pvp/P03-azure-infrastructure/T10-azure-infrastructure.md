# Task: T10 Azure 전용 인프라와 배포 workflow

## Status: pending

## Goal
기존 리소스와 분리된 내부 게임용 Azure 리소스 정의와 앱별 배포 workflow를 준비하고 비용 확인이 가능한 what-if 검증까지 통과시킨다.

## Decision Summary
- Resource group과 subscription을 매개변수로 받는다. 계획 위치 기본값은 East Asia이며 실제 create 전 확인한다.
- Static Web Apps Standard, Functions Flex Consumption JavaScript, Azure SQL GP Provisioned, SignalR Free, Function host storage를 새로 만든다.
- 이 Task는 template와 workflow만 만들며 실제 Azure create/deploy는 하지 않는다.

## Implementation

### I01. Bicep 리소스와 최소 권한
- Related Files:
  - infra/main.bicep :: top-level parameters/modules — dedicated resource graph; new.
  - infra/modules/static-web-app.bicep :: Standard SWA; new.
  - infra/modules/function-app.bicep :: Linux Node 22 Flex Consumption, system managed identity; new.
  - infra/modules/sql.bicep :: SQL server/database/GP Provisioned; new.
  - infra/modules/signalr.bicep :: SignalR Free, Serverless mode; new.
  - infra/modules/function-storage.bicep :: Functions host storage; new.
  - infra/parameters.example.json :: nonsecret parameter example; new.
  - infra/entra-setup.md :: SPA/API app registration, scope, tenant config; new.
- Details:
  - Required parameters: location, resourceNamePrefix, sqlVcores, sqlMaxSizeGb, tenantId, spaClientId, apiAppId. location defaults to eastasia but resourceGroupName and subscription are CLI parameters, never hard-coded.
  - Provision separate names with prefix knight-run-int and unique suffix: SWA Standard, Linux Function app in Flex Consumption, SQL logical server/database General Purpose Provisioned, SignalR Free, StorageV2 Standard_LRS.
  - sqlVcores default 2 as deployment starting value; it is an implementation default, not a user-selected size. Keep it a parameter and calculate monthly cost before P04.
  - SQL authentication uses Microsoft Entra-only authentication. Add Function system-assigned managed identity as SQL contained user with connect and required DML grants only.
  - Function API remains publicly reachable for the SWA linked backend but every data endpoint validates Entra API access token. SQL public network is enabled only with firewall rules for the Function app's possible outbound IPs; deployment script reads the Function resource outbound list and applies all addresses. Never create a broad 0.0.0.0-255.255.255.255 rule.
  - Function app setting values use nonsecret identifiers. SignalR connection secret is passed as secure deployment input/application setting and never committed. Do not create client secret in frontend environment.
  - Flex Consumption requires its dedicated host storage account. Give Function managed identity access only where supported; storage credentials are deployment secrets if MI host storage is unavailable in selected configuration.
  - Configure MSAL Browser SPA registration and the single-tenant protected API. Static files may load publicly, but game startup is gated by MSAL and every data endpoint validates the access token. Link one Function App to SWA /api route. API workflow sets api_location empty because BYO Functions supplies the API.
  - SignalR mode is Serverless and not used as an arbitrary WebSocket route through SWA; browser connects directly to the negotiated SignalR endpoint.
  - Entra app registration is tenant-scoped: SPA redirect origin, API audience and exposed user access scope, authorized tenant only. Store resulting IDs in app settings; no credential values in Git.
  - GitHub workflow uses separate jobs/deploy roots for frontend and api. Frontend SWA deploy uses a protected environment deployment-token secret; Functions deployment uses repository federated identity where available, otherwise a protected Azure credential. Workflow must not deploy on arbitrary pull_request branches. API job runs package check/test scripts rather than assuming a bundling step.

### I02. Template, workflow and cost validation
- Related Files:
  - .github/workflows/deploy-game.yml :: frontend/API deployment; new.
  - infra/scripts/set-sql-firewall.ps1 :: outbound IP firewall rules; new.
  - infra/README.md :: what-if, cost inputs, deployment order and rollback; new.
- Details:
  - deployment order: resource group selection -> Bicep what-if -> explicit human go-ahead -> resource deployment -> Entra app registration values -> API settings/SQL migration -> link Function to SWA -> deploy frontend/API -> smoke validation.
  - `az deployment group what-if` is read-only and requires selected resource group. In this plan task do not run `az deployment group create`.
  - README cost worksheet lists SQL vCore/hourly provisioned billing, SQL storage/backup, Functions executions/storage, SWA Standard, SignalR Free limits, and potential outbound networking. Do not write a fixed monthly amount without region/offer confirmation.
  - Deployment workflow uses Node 22, `npm ci`, build, unit validation, frontend artifact deploy and separate API package deploy. No automatic resource provisioning on push.

## Acceptance Criteria
- [ ] Bicep compiles and resource graph uses new names only.
- [ ] What-if output lists only intended resources and no deletion/update of existing game resources.
- [ ] SQL access uses Entra/managed identity and never broad firewall ranges.
- [ ] Workflow does not provision Azure resources and uses separate frontend/API outputs.
- [ ] cost, region, resource group, vCore and SignalR limits are explicit predeployment inputs.

## Validation
    az bicep build --file infra/main.bicep
    npm run build
    npm --prefix api test
    az deployment group what-if --resource-group <approved-resource-group> --template-file infra/main.bicep --parameters infra/parameters.example.json

## Commit Message
    chore(infra): prepare dedicated Azure deployment templates

    Plan: 2026-10-21-internal-online-ranking-pvp
    Phase: P03-azure-infrastructure
    Task: T10-azure-infrastructure

    - Define isolated SWA, Functions, SQL and SignalR resources
    - Add cost-aware deployment workflow and read-only what-if path

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
