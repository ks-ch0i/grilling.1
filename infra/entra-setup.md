# Microsoft Entra setup

The API is single-tenant. The game code uses MSAL Browser, sends an access token for the API scope, and the Functions endpoints validate that token. Do not create a client secret for the SPA.

## 1. Register the protected API

1. In the internal Microsoft Entra tenant, create an app registration with **Accounts in this organizational directory only**.
2. Set the application ID URI to `api://<API_APP_ID>`.
3. Expose a delegated scope named `access_as_user` and enable administrators and users to consent according to company policy.
4. Configure the access token version as **2** so the issuer is `https://login.microsoftonline.com/<TENANT_ID>/v2.0`.
5. Record the tenant ID and API app ID. These become Bicep inputs `tenantId` and `apiAppId`; the API audience setting is `api://<API_APP_ID>`.

## 2. Register the browser SPA

1. Create a second single-tenant app registration and add the **Single-page application** platform.
2. Add the redirect URI `https://<STATIC_WEB_APP_HOST>/auth-popup.html` after the Static Web App hostname is known. Add a custom-domain URI only if that domain will be used.
3. Add delegated permission to the API's `access_as_user` scope and grant consent using the tenant's normal process.
4. Record the SPA client ID. The browser build uses `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_SPA_CLIENT_ID`, and `VITE_ENTRA_API_SCOPE=api://<API_APP_ID>/access_as_user`.
5. Do not create or store a SPA client secret. Client IDs and tenant IDs are identifiers, not credentials.

The API app registration and SPA app registration are separate. Static Web Apps serves the browser files publicly; the game client gates online functions through MSAL, and each data API independently requires a valid tenant access token.
