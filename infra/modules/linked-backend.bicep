param staticWebAppName string
param functionAppId string
param functionRegion string

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' existing = {
  name: staticWebAppName
}

resource linkedBackend 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = {
  parent: staticWebApp
  name: 'api'
  properties: {
    backendResourceId: functionAppId
    region: functionRegion
  }
}

output linkedBackendId string = linkedBackend.id
