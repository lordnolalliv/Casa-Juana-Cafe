$ErrorActionPreference = 'Stop'
$adminUsername = Read-Host 'Admin username'
$adminPassword = Read-Host 'Admin password (12-72 bytes)' -AsSecureString
$adminPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPassword)
$previousOutputEncoding = $OutputEncoding
try {
    $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $adminPlaintext = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPointer)
    @{ username = $adminUsername; password = $adminPlaintext } | ConvertTo-Json -Compress | php "$PSScriptRoot/create-admin.php"
    if ($LASTEXITCODE -ne 0) { throw 'Admin setup failed.' }
} finally {
    $OutputEncoding = $previousOutputEncoding
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPointer)
    $adminPlaintext = $null
    $adminPassword.Dispose()
}
