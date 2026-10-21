targetScope = 'resourceGroup'

@description('Azure region. Confirm region availability and cost before provisioning.')
param location string = 'eastasia'

@description('Dedicated naming prefix for this internal game deployment.')
param resourceNamePrefix string = 'knight-run-int'

@description('Microsoft Entra tenant ID used by the SPA and protected API.')
param tenantId string

@description('SPA app registration client ID.')
param spaClientId string

@description('Protected API app registration client ID.')
param apiAppId string

@description('Optional exact HTTPS origins for approved custom game domains. Do not use a wildcard.')
param additionalSignalrOrigins array = []

@description('Object ID of the Microsoft Entra administrator for Azure SQL.')
param entraAdminObjectId string

@description('Display name of the Microsoft Entra SQL administrator.')
param entraAdminDisplayName string

@description('Principal type of the Entra SQL administrator.')
@allowed([
  'User'
  'Group'
  'Application'
])
param entraAdminPrincipalType string = 'User'

@description('General Purpose Provisioned SQL vCore count. Starting default only; calculate cost before deployment.')
@minValue(2)
@maxValue(16)
param sqlVcores int = 2

@description('Maximum Azure SQL database size in GiB.')
@minValue(1)
@maxValue(4096)
param sqlMaxSizeGb int = 32

@description('Maximum Flex Consumption instances. Set according to expected concurrency and budget.')
@minValue(1)
@maxValue(1000)
param functionMaxInstances int = 20

@description('Flex Consumption memory per instance in MB.')
@allowed([
  2048
  4096
  8192
])
param functionInstanceMemoryMb int = 2048

var suffix = substring(uniqueString(subscription().id, resourceGroup().id), 0, 13)
var storageSuffix = substring(uniqueString(subscription().id, resourceGroup().id), 0, 12)
var baseName = '${resourceNamePrefix}-${suffix}'
var storageAccountName = 'knightrunint${storageSuffix}'
var sqlServerName = replace(baseName, '-', '')

module functionStorage 'modules/function-storage.bicep' = {
  name: 'functionStorage-${suffix}'
  params: {
    location: location
    storageAccountName: storageAccountName
    tags: {
      application: 'knight-run'
      environment: 'internal'
    }
  }
}

module sql 'modules/sql.bicep' = {
  name: 'sql-${suffix}'
  params: {
    location: location
    sqlServerName: sqlServerName
    databaseName: '${baseName}-db'
    tenantId: tenantId
    entraAdminObjectId: entraAdminObjectId
    entraAdminDisplayName: entraAdminDisplayName
    entraAdminPrincipalType: entraAdminPrincipalType
    sqlVcores: sqlVcores
    sqlMaxSizeGb: sqlMaxSizeGb
    tags: {
      application: 'knight-run'
      environment: 'internal'
    }
  }
}

module staticWebApp 'modules/static-web-app.bicep' = {
  name: 'staticWebApp-${suffix}'
  params: {
    location: location
    staticWebAppName: baseName
    tags: {
      application: 'knight-run'
      environment: 'internal'
    }
  }
}

module signalr 'modules/signalr.bicep' = {
  name: 'signalr-${suffix}'
  params: {
    location: location
    signalrName: '${baseName}-signalr'
    allowedOrigins: union([
      'https://${staticWebApp.outputs.defaultHostname}'
    ], additionalSignalrOrigins)
    tags: {
      application: 'knight-run'
      environment: 'internal'
    }
  }
}

module functionApp 'modules/function-app.bicep' = {
  name: 'functionApp-${suffix}'
  params: {
    location: location
    functionAppName: '${baseName}-api'
    functionPlanName: '${baseName}-plan'
    storageAccountName: functionStorage.outputs.storageAccountName
    storageBlobEndpoint: functionStorage.outputs.storageBlobEndpoint
    deploymentContainerName: functionStorage.outputs.deploymentContainerName
    sqlServerFqdn: sql.outputs.sqlServerFqdn
    databaseName: sql.outputs.databaseName
    tenantId: tenantId
    apiAppId: apiAppId
    signalrName: signalr.outputs.signalrName
    signalrEndpoint: signalr.outputs.endpoint
    functionMaxInstances: functionMaxInstances
    functionInstanceMemoryMb: functionInstanceMemoryMb
    tags: {
      application: 'knight-run'
      environment: 'internal'
    }
  }
}

module linkedBackend 'modules/linked-backend.bicep' = {
  name: 'linkedBackend-${suffix}'
  params: {
    staticWebAppName: baseName
    functionAppId: functionApp.outputs.functionAppId
    functionRegion: location
  }
}

output resourceNameSuffix string = suffix
output staticWebAppName string = staticWebApp.outputs.staticWebAppName
output staticWebAppHostname string = staticWebApp.outputs.defaultHostname
output functionAppName string = functionApp.outputs.functionAppName
output sqlServerName string = sql.outputs.sqlServerName
output sqlDatabaseName string = sql.outputs.databaseName
output signalrName string = signalr.outputs.signalrName
output storageAccountName string = functionStorage.outputs.storageAccountName
output spaClientId string = spaClientId
