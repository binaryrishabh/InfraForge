#!/usr/bin/env bash
set -euo pipefail
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz -o "$work/actionlint.tar.gz"
printf '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8  %s\n' "$work/actionlint.tar.gz" | sha256sum --check --status
tar -xzf "$work/actionlint.tar.gz" -C "$work" actionlint
"$work/actionlint" -color
