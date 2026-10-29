#!/bin/bash
# Doppelklick-Starter für macOS (bei Blockierung: Rechtsklick > Öffnen, siehe README)
cd "$(dirname "$0")" || exit 1
bash installer/install.sh "$@"
status=$?
echo
read -r -p "Zum Schließen Enter drücken ..." _
exit $status
