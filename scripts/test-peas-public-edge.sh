#!/usr/bin/env bash
set -Eeuo pipefail

die() { printf '[peas-verify] %s\n' "$*" >&2; exit 1; }
require() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

require curl
require jq
require openssl

base_url="${PUBLIC_APP_URL:?PUBLIC_APP_URL is required}"
document_id="${PEAS_VERIFY_PUBLIC_DOCUMENT_ID:?PEAS_VERIFY_PUBLIC_DOCUMENT_ID is required}"
csp_mode="${PEAS_CSP_MODE:-report-only}"
certificate_min_days="${PEAS_CERTIFICATE_MIN_DAYS:-14}"
[[ "$base_url" =~ ^https://[^/?#]+/?$ ]] || die 'PUBLIC_APP_URL must be an HTTPS origin without a path, query, or fragment'
[[ "$document_id" =~ ^[1-9][0-9]*$ ]] || die 'PEAS_VERIFY_PUBLIC_DOCUMENT_ID must be a positive integer'
[[ "$csp_mode" == report-only || "$csp_mode" == enforce ]] || die 'PEAS_CSP_MODE must be report-only or enforce'
[[ "$certificate_min_days" =~ ^[1-9][0-9]*$ ]] || die 'PEAS_CERTIFICATE_MIN_DAYS must be a positive integer'

base_url="${base_url%/}"
authority="${base_url#https://}"
host="${authority%%:*}"
port="${authority##*:}"
[[ "$authority" == "$host" ]] && port=443

verification_tmp="$(mktemp -d)"
trap 'rm -rf -- "$verification_tmp"' EXIT

header_value() {
  local file="$1" name="$2"
  awk -v target="$name" 'BEGIN{IGNORECASE=1} index($0,target ":")==1{sub(/^[^:]+:[[:space:]]*/,"");sub(/\r$/,"");print;exit}' "$file"
}

request() {
  local method="$1" path="$2" expected="$3" label="$4" prefix="$5"
  local status
  status="$(curl --silent --show-error --max-time 30 --request "$method" --dump-header "$verification_tmp/$prefix.headers" --output "$verification_tmp/$prefix.body" --write-out '%{http_code}' "$base_url$path")"
  [[ "$status" == "$expected" ]] || die "$label returned HTTP $status; expected $expected"
}

assert_common_headers() {
  local file="$1" label="$2" csp_header
  [[ "$(header_value "$file" X-Content-Type-Options)" == nosniff ]] || die "$label is missing X-Content-Type-Options: nosniff"
  [[ "$(header_value "$file" Referrer-Policy)" == strict-origin-when-cross-origin ]] || die "$label has the wrong Referrer-Policy"
  [[ "$(header_value "$file" Permissions-Policy)" =~ camera=\(\).*microphone=\(\).*geolocation=\(\) ]] || die "$label has the wrong Permissions-Policy"
  [[ "$(header_value "$file" X-Frame-Options)" == SAMEORIGIN ]] || die "$label is missing X-Frame-Options: SAMEORIGIN"
  [[ "$(header_value "$file" Strict-Transport-Security)" =~ ^max-age=31536000\;[[:space:]]*includeSubDomains$ ]] || die "$label has the wrong HSTS policy"
  csp_header=Content-Security-Policy-Report-Only
  [[ "$csp_mode" == enforce ]] && csp_header=Content-Security-Policy
  local csp="$(header_value "$file" "$csp_header")"
  for directive in "default-src 'self'" "object-src 'none'" "base-uri 'self'" "form-action 'self'" "frame-ancestors 'self'"; do
    [[ "$csp" == *"$directive"* ]] || die "$label is missing CSP directive: $directive"
  done
  [[ "$csp" == *"report-uri /api/security/csp-report"* ]] || die "$label is missing the CSP report-uri directive"
  [[ "$csp" == *"report-to peas-csp"* ]] || die "$label is missing the CSP report-to directive"
  [[ "$(header_value "$file" Reporting-Endpoints)" == 'peas-csp="/api/security/csp-report"' ]] || die "$label is missing the Reporting-Endpoints policy"
}

http_status="$(curl --silent --show-error --max-time 20 --output /dev/null --dump-header "$verification_tmp/redirect.headers" --write-out '%{http_code}' "http://$host/")"
[[ "$http_status" =~ ^30[1278]$ ]] || die "HTTP did not redirect; received $http_status"
[[ "$(header_value "$verification_tmp/redirect.headers" Location)" == https://"$authority"/* ]] || die 'HTTP redirect did not target the canonical HTTPS host'

openssl s_client -connect "$host:$port" -servername "$host" -verify_hostname "$host" -verify_return_error </dev/null 2>"$verification_tmp/tls.stderr" \
  | openssl x509 -noout -checkend "$((certificate_min_days * 86400))" >/dev/null \
  || die "TLS certificate is invalid or expires within $certificate_min_days days"

request GET /index.html 200 'HTML response' html html
request GET /health/live 200 'JSON response' live live
request GET /health/ready 200 'database readiness response' ready ready
request GET /api/authors/all 401 'unauthenticated admin-author response' admin admin
request GET /api/__peas_verification_missing__ 404 'JSON error response' error error
for probe in html live ready admin error; do assert_common_headers "$verification_tmp/$probe.headers" "$probe response"; done
jq -e '.status == "ok" and (keys == ["status"])' "$verification_tmp/live.body" >/dev/null || die '/health/live exposed an unexpected response shape'
jq -e '.status == "ready"' "$verification_tmp/ready.body" >/dev/null || die '/health/ready did not report ready'

csp_receiver_status="$(curl --silent --show-error --max-time 20 --request POST --header 'Content-Type: text/plain' --data '{}' --dump-header "$verification_tmp/csp-receiver.headers" --output "$verification_tmp/csp-receiver.body" --write-out '%{http_code}' "$base_url/api/security/csp-report")"
[[ "$csp_receiver_status" == 415 ]] || die "CSP report receiver media-type probe returned HTTP $csp_receiver_status; expected 415"
assert_common_headers "$verification_tmp/csp-receiver.headers" 'CSP report receiver media-type probe'
[[ "$(header_value "$verification_tmp/csp-receiver.headers" Cache-Control)" == *no-store* ]] || die 'CSP report receiver is missing Cache-Control: no-store'

request GET /assets/__peas_verification_missing__.js.map 404 'source-map probe' sourcemap sourcemap
trace_status="$(curl --silent --show-error --max-time 20 --request TRACE --output /dev/null --write-out '%{http_code}' "$base_url/")"
((trace_status >= 400)) || die "TRACE was not rejected; received HTTP $trace_status"

request GET /.well-known/security.txt 200 security.txt security security
grep -Eq '^Contact: mailto:.+@.+$' "$verification_tmp/security.body" || die 'security.txt is missing Contact'
grep -Eq '^Expires: .+$' "$verification_tmp/security.body" || die 'security.txt is missing Expires'

request GET "/api/guest/documents/$document_id/authors" 200 'guest author response' authors authors
assert_common_headers "$verification_tmp/authors.headers" 'guest author response'
jq -e '.success == true and (.authors | type == "array") and all(.authors[]; ((keys | sort) == ["full_name","id"]) and (.id | type == "string") and (.full_name | type == "string") and (.full_name | length > 0))' "$verification_tmp/authors.body" >/dev/null \
  || die 'guest author response exposed an unexpected field or value'

request GET "/api/public/documents/$document_id/download" 200 'public PDF download' pdf pdf
assert_common_headers "$verification_tmp/pdf.headers" 'public PDF download'
[[ "$(header_value "$verification_tmp/pdf.headers" Content-Type)" == application/pdf* ]] || die 'public download is not application/pdf'
[[ "$(header_value "$verification_tmp/pdf.headers" Content-Disposition)" == attachment\;* ]] || die 'public PDF is not an attachment'
[[ "$(header_value "$verification_tmp/pdf.headers" Cache-Control)" == *no-store* ]] || die 'public PDF is missing Cache-Control: no-store'

jq -n \
  --arg status passed \
  --arg baseUrl "$base_url" \
  --arg checkedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg cspMode "$csp_mode" \
  --argjson publicDocumentId "$document_id" \
  '{status:$status,baseUrl:$baseUrl,checkedAt:$checkedAt,cspMode:$cspMode,publicDocumentId:$publicDocumentId,checks:["http_redirect","tls_certificate","html_json_error_headers","database_readiness","admin_author_unauthenticated","csp_report_receiver","source_maps_unavailable","trace_rejected","security_txt","public_author_dto","public_pdf_controls"]}'
