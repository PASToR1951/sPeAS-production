#!/bin/sh
# Linux converter: no network, no secrets, source-only read access, job-only writes.
# Requires unprivileged user namespaces. Fail closed if the host disables them.
set -eu
conversion_source=''
conversion_output=''
previous=''
for argument in "$@"; do
  if [ "$previous" = '--outdir' ]; then conversion_output="$argument"; fi
  previous="$argument"
  conversion_source="$argument"
done
if [ "$#" -eq 1 ] && [ "$1" = '--version' ]; then
  exec /usr/bin/soffice --version
fi
[ -f "$conversion_source" ] && [ -d "$conversion_output" ]
exec bwrap --unshare-all --die-with-parent --new-session \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind-try /lib64 /lib64 \
  --ro-bind /etc/fonts /etc/fonts --proc /proc --dev /dev --tmpfs /tmp \
  --ro-bind "$conversion_source" "$conversion_source" \
  --bind "$conversion_output" "$conversion_output" \
  --chdir "$conversion_output" -- /usr/bin/soffice "$@"
