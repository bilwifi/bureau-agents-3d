#!/bin/sh
# Lanceur Codex du bureau des agents (même interface de sortie que codex-run.sh).
# Usage : lanceur.sh <nom> <consigne> <dossier-sortie> <depot> <codex> <modele> [mission|suite] [session-id]
# Sorties : <dossier-sortie>/<nom>.log (flux puis exit=N), <dossier-sortie>/<nom>.last.md (rapport final).
set -u
N=$1; P=$2; OUT=$3; DEPOT=$4; CODEX=$5; M=$6; MODE=${7:-mission}; SID=${8:-}
mkdir -p "$OUT"
cd "$DEPOT" || { echo "depot introuvable : $DEPOT" > "$OUT/$N.log"; echo "exit=2" >> "$OUT/$N.log"; exit 2; }
echo "model=$M" > "$OUT/$N.log"
echo "lance_par=bureau mode=$MODE $(date '+%Y-%m-%d %H:%M')" >> "$OUT/$N.log"
if [ "$MODE" = suite ]; then
  set -- exec resume "$SID" -m "$M" --dangerously-bypass-approvals-and-sandbox -o "$OUT/$N.last.md" -
else
  set -- exec -m "$M" --dangerously-bypass-approvals-and-sandbox --color never -o "$OUT/$N.last.md" -
fi
# caffeinate (macOS) : la machine ne se met pas en veille tant que le travail tourne.
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -i "$CODEX" "$@" < "$P" >> "$OUT/$N.log" 2>&1
else
  "$CODEX" "$@" < "$P" >> "$OUT/$N.log" 2>&1
fi
rc=$?
echo "exit=$rc" >> "$OUT/$N.log"
exit $rc
