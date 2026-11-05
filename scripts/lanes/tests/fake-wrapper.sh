#!/usr/bin/env bash
# Stands in for "codex exec": session id line, behavior script, then the CODEX_DONE marker. One worker per account.
cat /proc/$$/winpid > "$OPS/fake/active-$ACCOUNT"
echo "$(date -Iseconds) start $SLICE $BRIEF" >> "$OPS/fake/ledger.txt"
echo "session id: 11111111-2222-3333-4444-555555555555"
BEH="$OPS/fake/${BRIEF%.md}.sh"; [ -f "$BEH" ] || BEH="$OPS/fake/default.sh"
bash "$BEH"; code=$?
echo "$(date -Iseconds) end $SLICE" >> "$OPS/fake/ledger.txt"
rm -f "$OPS/fake/active-$ACCOUNT"
echo "CODEX_DONE exit=$code account=$ACCOUNT"
