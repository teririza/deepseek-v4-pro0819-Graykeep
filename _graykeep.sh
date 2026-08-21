#!/usr/bin/env sh
# dsh-graykeep · zero-dependency launcher for macOS / Linux
# One-click flow:  ./_graykeep.sh pin   -> paste session id -> done
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node "$DIR/bin/graykeep.js" "$@"
