# Dedicated internal Azure deployment

This directory defines a new, isolated resource graph for Knight Run. The Bicep template is scoped to a resource group and does not select a subscription or resource group. Names use the `knight-run-int` prefix and a deterministic suffix derived from the selected subscription and resource group. Nothing in the GitHub deployment workflow creates infrastructure.

## Resources and security

- Static Web Apps Standard, with its `/api` route linked to the dedicated Function App.
- Linux Azure Functions Flex Consumption, Node.js 22, system-assigned managed identity, and a dedicated StorageV2 host/deployment account.
- Azure SQL Database General Purpose Provisioned with Entra-only authentication. The 2-vCore and 32-GiB defaults are planning examples, not approved capacity selections.
- Azure SignalR Free in Serverless mode. The Function App uses managed identity for negotiation and REST events; no SignalR key or connection string is stored in app settings.
- SignalR CORS allows only the generated Static Web Apps hostname by default. Add approved HTTPS custom-domain origins through `additionalSignalrOrigins`; never use `*`.
- The Function identity receives the storage data roles required by the Functions host and a resource-scoped SignalR Service Owner role for Serverless negotiation. SQL access is granted after schema creation by `scripts/grant-function-sql-access.sql`, limited to `CONNECT` and DML on the application tables.
- SQL public networking is enabled without a broad firewall exception. After the Function App is provisioned, `scripts/set-sql-firewall.ps1` reads its possible outbound IPv4 addresses and creates one exact-address rule per address. Re-run it if the Function App's possible outbound IP list changes. It only removes stale rules named with its `function-egress-` prefix.

## Parameters and read-only review

1. Confirm the intended Azure subscription, a new or explicitly approved dedicated resource group, region availability, SQL capacity, and current SignalR Free limits.
2. Copy `parameters.example.json` to the ignored `parameters.local.json`. The placeholder IDs can be used for a read-only graph preview only; replace them with actual Entra IDs and the administrator name before any resource creation. Keep actual environment parameters out of Git.
3. Build the template and review the resource graph:

   ```powershell
   az bicep build --file infra/main.bicep
   az deployment group what-if --subscription <approved-subscription-id> --resource-group <approved-resource-group> --template-file infra/main.bicep --parameters infra/parameters.local.json
   ```

4. Check that the what-if targets only the dedicated `knight-run-int` resources. Stop if it shows any existing game resource being modified or deleted. A what-if is a preview; it does not authorize resource creation.
5. After deployment, use the `staticWebAppHostname` output for the SPA redirect URI. If the company chooses a custom game domain, add that exact HTTPS origin to `additionalSignalrOrigins` and the SPA redirect URI list.

## Cost worksheet

Do not use a fixed monthly estimate from this repository. Before any deployment, price the selected region, subscription offer, database size, and expected traffic in the Azure Pricing Calculator, then record the estimate and owner in the rollout record.

| Cost driver | Input to confirm | Billing behavior to account for |
| --- | --- | --- |
| Azure SQL GP Provisioned | vCores, database size, backup retention, region | Provisioned compute is billed while allocated, including idle periods; storage and backup add separate charges. |
| Functions Flex Consumption | executions, execution duration, memory, maximum instances, outbound traffic | Consumption depends on executions and allocated memory/time, subject to current free grants and plan rules. |
| Function host/deployment Storage | capacity, transactions, redundancy, region | Storage capacity and operations are billed separately. Current template uses Standard LRS. |
| Static Web Apps Standard | plan and any custom domain/egress requirements | Standard has a recurring plan cost; verify current plan price and included allowances. |
| Azure SignalR Free | concurrent connections, messages/day, region/availability | The project decision records 20 concurrent connections and 20,000 messages/day and marks Free as Dev/Test. Recheck these limits and eligibility before rollout. |
| Network egress | expected API, database and browser traffic | Cross-service and internet egress may add cost; check the selected region and current pricing. |

## Entra and GitHub setup

Complete [entra-setup.md](./entra-setup.md) and then configure the GitHub repository's `internal` environment. Protect the environment with the organization's approval rules before enabling deployments.

Environment variables:

- `ENTRA_TENANT_ID`
- `ENTRA_SPA_CLIENT_ID`
- `ENTRA_API_SCOPE` (`api://<API_APP_ID>/access_as_user`)
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- `AZURE_FUNCTIONAPP_NAME` (the `functionAppName` Bicep output)

Environment secret:

- `AZURE_STATIC_WEB_APPS_API_TOKEN` (deployment token for the dedicated Static Web App)

Configure a user-assigned managed identity as the GitHub OIDC deployment identity, with federated credential subject `repo:<OWNER>/<REPOSITORY>:environment:internal` and audience `api://AzureADTokenExchange`. Grant its `Website Contributor` role only on the Function App. The Static Web Apps token is a separate protected environment secret. The workflow has no pull-request trigger; manual runs from branches other than `main` are skipped.

## Provisioning and application rollout order

This sequence is a future rollout checklist and is not performed by the workflow:

1. Confirm subscription, resource group, region, SQL vCores/size, expected concurrency, SignalR Free limits, and a written cost estimate.
2. Run `what-if`; have an authorized owner review the exact resource list.
3. After a separate explicit go-ahead, an operator may run the resource-group deployment. This repository does not run `az deployment group create` automatically.
4. Configure Entra registrations and GitHub environment values/secrets.
5. Run `api/migrations/001-initial-schema.sql` as the Entra SQL administrator, then run `scripts/grant-function-sql-access.sql` as that administrator.
6. Apply the exact Function outbound-IP firewall rules with `scripts/set-sql-firewall.ps1`.
7. Confirm the Static Web Apps backend link and deploy the browser/API packages from `main`.
8. Perform authenticated smoke checks and confirm SQL connectivity, rankings, PvP, and the SignalR reconnect/polling behavior.

## Rollback

- For an application regression, redeploy the last known-good frontend artifact and API package from the protected `main` workflow or restore the corresponding source revision and redeploy.
- Keep the SQL database and migration history during application rollback. Do not roll back schema by deleting the resource group; a data/schema rollback needs a separately reviewed backup and migration plan.
- If a resource change needs reversal, review a new what-if against the same approved resource group and have the resource owner approve each deletion or replacement before applying it.
