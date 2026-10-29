#!/bin/bash
# Packt das Installationspaket nach dist/dc_onair-obs-setup.zip (Ausführungsrechte bleiben erhalten).
set -eo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/dc_onair-obs-setup.zip
zip -rqX dist/dc_onair-obs-setup.zip Install-macOS.command Install-Windows.bat README.md installer payload \
  -x "*/.DS_Store"
echo "dist/dc_onair-obs-setup.zip ($(du -h dist/dc_onair-obs-setup.zip | cut -f1))"
