#!/usr/bin/env bash
# Wrapper — canonical script lives in Node/IACursor/
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../IACursor/patch-tunnel-env.sh" "$@"
