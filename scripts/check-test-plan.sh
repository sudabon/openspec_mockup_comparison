#!/usr/bin/env bash
set -euo pipefail
# openspec/changes/ に差分がある PR で test-plan.md・mockup-compare.md とタグ付きテストの存在を検証
base="${1:-origin/main}"
# 差分が無いと grep -v が 1 を返し、pipefail で異常終了するため || true で受ける
ids=$(git diff --name-only "$base"...HEAD -- 'openspec/changes/**' \
  | { grep -v '/archive/' || true; } | cut -d/ -f3 | sort -u)
[ -z "$ids" ] && { echo "openspec change の差分なし。skip"; exit 0; }

fail=0
for id in $ids; do
  plan="openspec/changes/$id/test-plan.md"
  if [ ! -f "$plan" ]; then
    echo "::error::$id に test-plan.md がありません"; fail=1; continue
  fi
  if ! grep -rq -- "@$id" tests/e2e/; then
    echo "::error::@$id タグ付きの E2E テストが tests/e2e/ にありません"; fail=1
  fi

  # モック比較: mockup-compare.md の観点表の VC-ID ごとに、@<change-id> と @VC-NNN を持つテストファイルがあること
  compare="openspec/changes/$id/mockup-compare.md"
  if [ ! -f "$compare" ]; then
    echo "::error::$id に mockup-compare.md がありません"; fail=1; continue
  fi
  vcs=$(grep -oE '^\|[[:space:]]*VC-[0-9]{3}[[:space:]]*\|' "$compare" | grep -oE 'VC-[0-9]{3}' | sort -u || true)
  [ -z "$vcs" ] && { echo "$id: mockup-compare.md は比較対象なし。VC の検証を skip"; continue; }
  for vc in $vcs; do
    found=0
    while IFS= read -r f; do
      if grep -qF -- "@$id" "$f"; then found=1; break; fi
    done < <(grep -rlE -- "@$vc([^0-9]|\$)" tests/e2e/ || true)
    if [ "$found" -eq 0 ]; then
      echo "::error::$id の $vc に対応する @$vc タグ付きのモック比較テストが tests/e2e/ にありません"; fail=1
    fi
  done
done
exit $fail
