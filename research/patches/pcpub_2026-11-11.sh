#!/usr/bin/env bash
# PC fallback publish helper (11 Nov 2026): stage files changed since the last PC send and print the device_commit_files JSON.
set -e; (cd ~/nba_model && ./publish_site.sh ~/claudiopunt >/dev/null 2>&1 || true); cd ~/claudiopunt
TS=$(date +%s); OUT=/mnt/user-data/outputs/pc_$TS; mkdir -p $OUT
git fetch -q origin main; git diff --name-status origin/main HEAD | grep -v "^D" | awk "{print \$NF}" > /tmp/pc_files.txt
n=$(wc -l < /tmp/pc_files.txt); [ "$n" = 0 ] && { echo "site: nothing new for the PC"; exit 0; }
while read f; do mkdir -p "$OUT/$(dirname $f)"; cp "$f" "$OUT/$f"; done < /tmp/pc_files.txt
python3 -c "
import json,sys
fs=[l.strip() for l in open('/tmp/pc_files.txt') if l.strip()]
print(json.dumps([{'stagedPath':'$OUT/'+f,'devicePath':'C:\\\\Users\\\\user\\\\claudiopunt\\\\'+f.replace('/','\\\\')} for f in fs]))"
echo "files: $n "
