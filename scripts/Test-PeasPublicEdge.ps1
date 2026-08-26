#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [uri]$BaseUrl,
    [ValidateSet('report-only','enforce')]
    [string]$CspMode = 'report-only',
    [Parameter(Mandatory)]
    [ValidateRange(1, 2147483647)]
    [int]$PublicDocumentId,
    [ValidateRange(1, 365)]
    [int]$CertificateMinDays = 14
)

$ErrorActionPreference = 'Stop'

function Assert-Condition([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Get-Header([System.Net.Http.HttpResponseMessage]$Response, [string]$Name) {
    $values = $null
    if ($Response.Headers.TryGetValues($Name, [ref]$values)) { return ($values -join ', ') }
    if ($Response.Content.Headers.TryGetValues($Name, [ref]$values)) { return ($values -join ', ') }
    return ''
}

function Send-Request(
    [System.Net.Http.HttpClient]$Client,
    [System.Net.Http.HttpMethod]$Method,
    [string]$RelativePath,
    [string]$ContentType = '',
    [string]$Body = ''
) {
    $target = [uri]::new($BaseUrl, $RelativePath)
    $request = [System.Net.Http.HttpRequestMessage]::new($Method, $target)
    try {
        if (-not [string]::IsNullOrWhiteSpace($ContentType)) {
            $request.Content = [System.Net.Http.StringContent]::new($Body, [Text.Encoding]::UTF8, $ContentType)
        }
        return $Client.Send($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead)
    } finally {
        $request.Dispose()
    }
}

function Assert-SecurityHeaders([System.Net.Http.HttpResponseMessage]$Response, [string]$Label) {
    Assert-Condition ((Get-Header $Response 'X-Content-Type-Options') -ceq 'nosniff') "$Label is missing X-Content-Type-Options: nosniff."
    Assert-Condition ((Get-Header $Response 'Referrer-Policy') -ceq 'strict-origin-when-cross-origin') "$Label has the wrong Referrer-Policy."
    Assert-Condition ((Get-Header $Response 'Permissions-Policy') -match 'camera=\(\).*microphone=\(\).*geolocation=\(\)') "$Label has the wrong Permissions-Policy."
    Assert-Condition ((Get-Header $Response 'X-Frame-Options') -ceq 'SAMEORIGIN') "$Label is missing X-Frame-Options: SAMEORIGIN."
    $cspHeader = if ($CspMode -eq 'enforce') { 'Content-Security-Policy' } else { 'Content-Security-Policy-Report-Only' }
    $csp = Get-Header $Response $cspHeader
    foreach ($directive in @("default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'")) {
        Assert-Condition ($csp.Contains($directive, [StringComparison]::Ordinal)) "$Label is missing CSP directive: $directive."
    }
    Assert-Condition ($csp.Contains('report-uri /api/security/csp-report', [StringComparison]::Ordinal)) "$Label is missing the CSP report-uri directive."
    Assert-Condition ($csp.Contains('report-to peas-csp', [StringComparison]::Ordinal)) "$Label is missing the CSP report-to directive."
    Assert-Condition ((Get-Header $Response 'Reporting-Endpoints') -ceq 'peas-csp="/api/security/csp-report"') "$Label is missing the Reporting-Endpoints policy."
    Assert-Condition ((Get-Header $Response 'Strict-Transport-Security') -match '^max-age=31536000;\s*includeSubDomains$') "$Label is missing the approved HSTS policy."
}

function Assert-Status([System.Net.Http.HttpResponseMessage]$Response, [int]$Expected, [string]$Label) {
    Assert-Condition ([int]$Response.StatusCode -eq $Expected) "$Label returned HTTP $([int]$Response.StatusCode); expected $Expected."
}

Assert-Condition ($BaseUrl.Scheme -ceq 'https') 'BaseUrl must use HTTPS.'
Assert-Condition ([string]::IsNullOrEmpty($BaseUrl.Query) -and [string]::IsNullOrEmpty($BaseUrl.Fragment)) 'BaseUrl must not contain a query or fragment.'
Assert-Condition ($BaseUrl.AbsolutePath -ceq '/') 'BaseUrl must be an HTTPS origin without a path.'

$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(30)
$checked = [Collections.Generic.List[string]]::new()
$certificateDaysRemaining = 0.0

try {
    $httpBuilder = [UriBuilder]::new($BaseUrl)
    $httpBuilder.Scheme = 'http'
    $httpBuilder.Port = 80
    $redirectRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $httpBuilder.Uri)
    try { $redirect = $client.Send($redirectRequest) } finally { $redirectRequest.Dispose() }
    try {
        Assert-Condition ([int]$redirect.StatusCode -in @(301,302,307,308)) "HTTP did not redirect; received $([int]$redirect.StatusCode)."
        $location = $redirect.Headers.Location
        if ($location -and -not $location.IsAbsoluteUri) { $location = [uri]::new($httpBuilder.Uri, $location) }
        Assert-Condition ($location -and $location.Scheme -ceq 'https' -and $location.Host -ceq $BaseUrl.Host) 'HTTP redirect did not target the canonical HTTPS host.'
        $checked.Add('http_redirect')
    } finally { $redirect.Dispose() }

    $tcp = [Net.Sockets.TcpClient]::new()
    try {
        $port = if ($BaseUrl.IsDefaultPort) { 443 } else { $BaseUrl.Port }
        $tcp.Connect($BaseUrl.Host, $port)
        $tls = [Net.Security.SslStream]::new($tcp.GetStream(), $false)
        try {
            $tls.AuthenticateAsClient($BaseUrl.Host)
            $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($tls.RemoteCertificate)
            $remaining = $certificate.NotAfter.ToUniversalTime() - [DateTime]::UtcNow
            $certificateDaysRemaining = [math]::Round($remaining.TotalDays, 1)
            Assert-Condition ($certificate.NotBefore.ToUniversalTime() -le [DateTime]::UtcNow) 'TLS certificate is not valid yet.'
            Assert-Condition ($remaining.TotalDays -ge $CertificateMinDays) "TLS certificate expires in $([math]::Round($remaining.TotalDays, 1)) days; minimum is $CertificateMinDays."
            $checked.Add('tls_certificate')
        } finally { $tls.Dispose() }
    } finally { $tcp.Dispose() }

    foreach ($probe in @(
        @{Path='/index.html'; Status=200; Label='HTML response'},
        @{Path='/health/live'; Status=200; Label='JSON response'},
        @{Path='/health/ready'; Status=200; Label='database readiness response'},
        @{Path='/api/authors/all'; Status=401; Label='unauthenticated admin-author response'},
        @{Path='/api/__peas_verification_missing__'; Status=404; Label='JSON error response'}
    )) {
        $response = Send-Request $client ([System.Net.Http.HttpMethod]::Get) $probe.Path
        try {
            Assert-Status $response $probe.Status $probe.Label
            Assert-SecurityHeaders $response $probe.Label
        } finally { $response.Dispose() }
    }
    $checked.Add('html_json_error_headers')
    $checked.Add('database_readiness')
    $checked.Add('admin_author_unauthenticated')

    $cspReceiver = Send-Request $client ([System.Net.Http.HttpMethod]::Post) '/api/security/csp-report' 'text/plain' '{}'
    try {
        Assert-Status $cspReceiver 415 'CSP report receiver media-type probe'
        Assert-SecurityHeaders $cspReceiver 'CSP report receiver media-type probe'
        Assert-Condition ((Get-Header $cspReceiver 'Cache-Control') -match '(^|,)\s*no-store\s*(,|$)') 'CSP report receiver is missing Cache-Control: no-store.'
    } finally { $cspReceiver.Dispose() }
    $checked.Add('csp_report_receiver')

    $sourceMap = Send-Request $client ([System.Net.Http.HttpMethod]::Get) '/assets/__peas_verification_missing__.js.map'
    try { Assert-Status $sourceMap 404 'source-map probe' } finally { $sourceMap.Dispose() }
    $checked.Add('source_maps_unavailable')

    $trace = Send-Request $client ([System.Net.Http.HttpMethod]::Trace) '/'
    try { Assert-Condition ([int]$trace.StatusCode -ge 400) "TRACE was not rejected; received HTTP $([int]$trace.StatusCode)." } finally { $trace.Dispose() }
    $checked.Add('trace_rejected')

    $securityText = Send-Request $client ([System.Net.Http.HttpMethod]::Get) '/.well-known/security.txt'
    try {
        Assert-Status $securityText 200 'security.txt'
        $securityBody = $securityText.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        Assert-Condition ($securityBody -match '(?m)^Contact: mailto:.+$' -and $securityBody -match '(?m)^Expires: .+$') 'security.txt is missing Contact or Expires.'
    } finally { $securityText.Dispose() }
    $checked.Add('security_txt')

    $authors = Send-Request $client ([System.Net.Http.HttpMethod]::Get) "/api/guest/documents/$PublicDocumentId/authors"
    try {
        Assert-Status $authors 200 'guest author response'
        Assert-SecurityHeaders $authors 'guest author response'
        $authorPayload = $authors.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json -Depth 10
        Assert-Condition ($authorPayload.success -eq $true) 'Guest author response did not report success.'
        foreach ($author in @($authorPayload.authors)) {
            $keys = @($author.PSObject.Properties.Name | Sort-Object)
            Assert-Condition (($keys -join ',') -ceq 'full_name,id') "Guest author DTO exposed unexpected keys: $($keys -join ', ')."
            Assert-Condition ($author.id -is [string] -and -not [string]::IsNullOrWhiteSpace($author.full_name)) 'Guest author DTO has an invalid id or full_name.'
        }
    } finally { $authors.Dispose() }
    $checked.Add('public_author_dto')

    $pdf = Send-Request $client ([System.Net.Http.HttpMethod]::Get) "/api/public/documents/$PublicDocumentId/download"
    try {
        Assert-Status $pdf 200 'public PDF download'
        Assert-SecurityHeaders $pdf 'public PDF download'
        Assert-Condition ((Get-Header $pdf 'Content-Type') -match '^application/pdf') 'Public download is not application/pdf.'
        Assert-Condition ((Get-Header $pdf 'Content-Disposition') -match '^attachment;') 'Public PDF is not an attachment.'
        Assert-Condition ((Get-Header $pdf 'Cache-Control') -match '(^|,)\s*no-store\s*(,|$)') 'Public PDF is missing Cache-Control: no-store.'
    } finally { $pdf.Dispose() }
    $checked.Add('public_pdf_controls')

    [ordered]@{
        status = 'passed'
        baseUrl = $BaseUrl.AbsoluteUri.TrimEnd('/')
        checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
        cspMode = $CspMode
        publicDocumentId = $PublicDocumentId
        certificateDaysRemaining = $certificateDaysRemaining
        checks = @($checked)
    } | ConvertTo-Json -Depth 5
} finally {
    $client.Dispose()
    $handler.Dispose()
}
