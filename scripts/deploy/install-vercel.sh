#!/usr/bin/env bash
set -euo pipefail
work=$(mktemp -d)
trap 'rm -f -- "$work/vercel-64.5.0.tgz"; rmdir -- "$work"' EXIT
# Reviewed registry.npmjs.org/vercel/64.5.0 dist.integrity, checked before npm executes package code.
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://registry.npmjs.org/vercel/-/vercel-64.5.0.tgz -o "$work/vercel-64.5.0.tgz"
expected='JsWnLGHojqd0YKmLeU4NHpeCEX7/jIKNydBMNf0DGJe5W/jVb+j8lMekLkCIXqFTb8LObLoAe+OZ6/XJt4AhyQ=='
actual=$(openssl dgst -sha512 -binary "$work/vercel-64.5.0.tgz" | openssl base64 -A)
[[ "$actual" == "$expected" ]] || { echo 'Vercel CLI integrity mismatch' >&2; exit 1; }
# Transitive npm dependencies remain registry-resolved; see PRODUCTION_BOOTSTRAP.md.
npm install --global "$work/vercel-64.5.0.tgz"
