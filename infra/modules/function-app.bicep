param location string
param functionAppName string
param functionPlanName string
param storageAccountName string
param storageBlobEndpoint string
param deploymentContainerName string
param sqlServerFqdn string
param databaseName string
param tenantId string
param apiAppId string
param signalrName string
param signalrEndpoint string
param functionMaxInstances int = 20
param functionInstanceMemoryMb int = 2048
param tags object = {}

var storageBlobDataOwnerRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var storageQueueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var signalrServiceOwnerRoleId = '7e4f1700-ea5a-4f59-8f37-079cfe29dce3'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: functionPlanName
  location: location
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
  tags: tags
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageBlobEndpoint}${last(split(deploymentContainerName, '/'))}'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      runtime: {
        name: 'node'
        version: '22'
      }
      scaleAndConcurrency: {
        maximumInstanceCount: functionMaxInstances
        instanceMemoryMB: functionInstanceMemoryMb
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        {
          name: 'AzureWebJobsStorage__accountName'
          value: storageAccountName
        }
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
        }
        {
          name: 'ENTRA_TENANT_ID'
          value: tenantId
        }
        {
          name: 'ENTRA_API_AUDIENCE'
          value: 'api://${apiAppId}'
        }
        {
          name: 'SQL_SERVER_FQDN'
          value: sqlServerFqdn
        }
        {
          name: 'SQL_DATABASE'
          value: databaseName
        }
        {
          name: 'SIGNALR_SERVICE_ENDPOINT'
          value: signalrEndpoint
        }
        {
          name: 'SIGNALR_HUB_NAME'
          value: 'rankings'
        }
      ]
    }
  }
  tags: tags
}

resource blobDataOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, app.name, storageBlobDataOwnerRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwnerRoleId)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource queueDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, app.name, storageQueueDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageQueueDataContributorRoleId)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource tableDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, app.name, storageTableDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributorRoleId)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource signalr 'Microsoft.SignalRService/signalR@2024-03-01' existing = {
  name: signalrName
}

resource signalrServiceOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(signalr.id, app.name, signalrServiceOwnerRoleId)
  scope: signalr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', signalrServiceOwnerRoleId)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output functionAppName string = app.name
output functionAppId string = app.id
output functionPrincipalId string = app.identity.principalId
