# Run this script as Administrator to allow inbound connections on ports 4200 (frontend) and 8000 (backend)
# so the QA Assistant can be accessed from other machines on the network.

$ports = @(4200, 8000)
$ruleNamePrefix = "QA Assistant"

foreach ($port in $ports) {
    $ruleName = "$ruleNamePrefix - Port $port"
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Rule '$ruleName' already exists. Skipping."
        continue
    }
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow
    Write-Host "Added firewall rule: $ruleName (TCP $port)"
}

Write-Host ""
Write-Host "Done. You can now access the app from other machines using http://<this-PC-IP>:4200"
Write-Host "To remove these rules later: Get-NetFirewallRule -DisplayName 'QA Assistant*' | Remove-NetFirewallRule"
