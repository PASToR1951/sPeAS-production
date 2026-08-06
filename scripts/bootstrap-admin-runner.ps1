# bootstrap-admin-runner.ps1
$env:BOOTSTRAP_ADMIN_ID = 'admin-001'
$env:BOOTSTRAP_ADMIN_NAME = 'System Administrator'
$env:BOOTSTRAP_ADMIN_EMAIL = 'admin@spud.edu.ph'
$env:BOOTSTRAP_ADMIN_PASSWORD = 'AdminSecurePassword2026!'

& (Join-Path $PSScriptRoot '..\ops\peas-deploy-native.ps1') bootstrap-admin
