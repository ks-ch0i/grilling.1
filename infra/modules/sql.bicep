param location string
param sqlServerName string
param databaseName string
param tenantId string
param entraAdminObjectId string
param entraAdminDisplayName string
param entraAdminPrincipalType string = 'User'
param sqlVcores int = 2
param sqlMaxSizeGb int = 32
param tags object = {}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  tags: tags
  properties: {
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: entraAdminPrincipalType
      login: entraAdminDisplayName
      sid: entraAdminObjectId
      tenantId: tenantId
    }
  }
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: databaseName
  location: location
  sku: {
    name: 'GP_Gen5_${sqlVcores}'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: sqlVcores
  }
  properties: {
    maxSizeBytes: sqlMaxSizeGb * 1073741824
    zoneRedundant: false
  }
}

resource azureAdOnlyAuthentication 'Microsoft.Sql/servers/azureADOnlyAuthentications@2021-02-01-preview' = {
  parent: sqlServer
  name: 'Default'
  properties: {
    azureADOnlyAuthentication: true
  }
}

output sqlServerName string = sqlServer.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output databaseName string = database.name
output sqlServerId string = sqlServer.id
