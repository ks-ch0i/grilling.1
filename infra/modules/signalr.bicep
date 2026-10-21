param location string
param signalrName string
param allowedOrigins array
param tags object = {}

resource signalr 'Microsoft.SignalRService/signalR@2024-03-01' = {
  name: signalrName
  location: location
  kind: 'SignalR'
  sku: {
    name: 'Free_F1'
    tier: 'Free'
    capacity: 1
  }
  properties: {
    cors: {
      allowedOrigins: allowedOrigins
    }
    features: [
      {
        flag: 'ServiceMode'
        value: 'Serverless'
      }
    ]
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
  tags: tags
}

output signalrName string = signalr.name
output endpoint string = 'https://${signalr.name}.service.signalr.net'
output signalrId string = signalr.id
