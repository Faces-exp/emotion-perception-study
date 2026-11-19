#!/bin/zsh
cd -- "$(dirname "$0")"
NODE="/Users/artem/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ ! -x "$NODE" ]]; then NODE="$(command -v node)"; fi
if [[ ! -x "$NODE" ]]; then print "Нужен Node.js 24 или новее."; read; exit 1; fi
print "Откройте в браузере http://127.0.0.1:8787"
"$NODE" server/local.mjs
