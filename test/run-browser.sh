#!/usr/bin/env bash
# 跑全部浏览器检查（test/*-check.mjs）。用法：在仓库根目录 bash test/run-browser.sh
# 需要：node、python3；首次会在 test/ 下装 playwright 和 jquery（test/node_modules 不进仓库）
# 已有浏览器时可设 PW_CHROME=/path/to/chrome，否则用 playwright 自带的 Chromium（npx playwright install chromium）
set -euo pipefail
cd "$(dirname "$0")/.."
node build.mjs >/dev/null
if [ ! -d test/node_modules/playwright ] || [ ! -d test/node_modules/jquery ]; then
  (cd test && [ -f package.json ] || npm init -y >/dev/null; npm i playwright@1.56 jquery@3 --no-audit --no-fund >/dev/null)
fi
cp test/node_modules/jquery/dist/jquery.min.js test/site/jquery.min.js
node test/fixtures/make-zsx-like.cjs > test/site/zsx.json
mkdir -p test/shots
python3 -m http.server 8765 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1
fail=0
for f in test/*-check.mjs; do
  if out=$(node "$f" 2>&1); then echo "✓ $f"; else echo "✗ $f"; echo "$out" | tail -20; fail=1; fi
done
exit $fail
