[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $SubscriptionId,
  [Parameter(Mandatory)] [string] $ResourceGroupName,
  [Parameter(Mandatory)] [string] $FunctionAppName,
  [Parameter(Mandatory)] [string] $SqlServerName
)

$ErrorActionPreference = 'Stop'

function Invoke-AzJson {
  param([Parameter(Mandatory)] [string[]] $Arguments)
  $result = & az @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Azure CLI command failed: az $($Arguments -join ' ')"
  }
  if ([string]::IsNullOrWhiteSpace(($result -join ''))) {
    return $null
  }
  return ($result -join "`n") | ConvertFrom-Json
}

& az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) {
  throw 'Could not select the supplied Azure subscription.'
}

$functionInfo = Invoke-AzJson -Arguments @(
  'functionapp', 'show', '--resource-group', $ResourceGroupName,
  '--name', $FunctionAppName, '--output', 'json'
)
$sqlServer = Invoke-AzJson -Arguments @(
  'sql', 'server', 'show', '--resource-group', $ResourceGroupName,
  '--name', $SqlServerName, '--output', 'json'
)

$rawAddresses = @($functionInfo.possibleOutboundIpAddresses -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($rawAddresses.Count -eq 0) {
  throw 'The Function App returned no possible outbound IP addresses; no firewall changes were made.'
}

$addresses = [System.Collections.Generic.List[string]]::new()
foreach ($address in $rawAddresses) {
  $parsed = $null
  if (-not [System.Net.IPAddress]::TryParse($address, [ref] $parsed) -or $parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw "The Function App returned a non-IPv4 address '$address'; no firewall changes were made."
  }
  if (-not $addresses.Contains($address)) {
    $addresses.Add($address)
  }
}

$existingRules = Invoke-AzJson -Arguments @(
  'sql', 'server', 'firewall-rule', 'list', '--resource-group', $ResourceGroupName,
  '--server', $SqlServerName, '--output', 'json'
)
$managedRules = @($existingRules | Where-Object { $_.name -like 'function-egress-*' })
$desiredNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

for ($index = 0; $index -lt $addresses.Count; $index++) {
  $ruleName = 'function-egress-{0:D3}' -f ($index + 1)
  [void] $desiredNames.Add($ruleName)
  $address = $addresses[$index]
  if ($managedRules.name -contains $ruleName) {
    & az sql server firewall-rule update --resource-group $ResourceGroupName --server $SqlServerName `
      --name $ruleName --start-ip-address $address --end-ip-address $address --output none
  } else {
    & az sql server firewall-rule create --resource-group $ResourceGroupName --server $SqlServerName `
      --name $ruleName --start-ip-address $address --end-ip-address $address --output none
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Could not apply firewall rule '$ruleName'. Existing stale rules were left in place."
  }
}

foreach ($rule in $managedRules) {
  if (-not $desiredNames.Contains($rule.name)) {
    & az sql server firewall-rule delete --resource-group $ResourceGroupName --server $SqlServerName `
      --name $rule.name --yes --output none
    if ($LASTEXITCODE -ne 0) {
      throw "Could not remove stale managed firewall rule '$($rule.name)'."
    }
  }
}

Write-Output "Applied $($addresses.Count) exact IPv4 firewall rules for Function App '$FunctionAppName' on SQL server '$($sqlServer.name)'."
