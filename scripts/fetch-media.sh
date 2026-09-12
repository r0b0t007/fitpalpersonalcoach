#!/usr/bin/env bash
# Manually download the exercise images (JPG) and animations (GIF) into ./media.
# Run this once after cloning. The app looks for them under ./media.
# Source: hasaneyldrm/exercises-dataset — MIT for the metadata and instruction text, but the
# images and GIFs are © Gym visual (https://gymvisual.com/), used under that dataset's terms.
# openGym does not redistribute or relicense them. See NOTICE.md.
set -euo pipefail
cd "$(dirname "$0")/.."

# Skipping what is already downloaded used to be the compose `media` service's job; it checked
# `ls -A /out/img` before cloning. Docker is gone and the guide still tells people this is safe
# to re-run, so the check lives here now — ~140 MB is not something to re-fetch by accident.
if [ "${1:-}" != "--force" ] && [ -n "$(ls -A media/img 2>/dev/null)" ] && [ -n "$(ls -A media/gif 2>/dev/null)" ]; then
  echo "✓ Exercise media already present ($(ls media/img | wc -l) images, $(ls media/gif | wc -l) GIFs). Re-run with --force to download it again."
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat <<'EOF'
↓ Downloading exercise media (~140 MB) from github.com/hasaneyldrm/exercises-dataset
  Metadata and instruction text: MIT.
  Images and animations: © Gym visual — https://gymvisual.com/
  Used under that dataset's terms, not openGym's AGPL; openGym does not redistribute them.
  Terms: https://gymvisual.com/content/3-terms-and-conditions-of-use
  Reusing this media yourself, commercially or not, needs your own licence from Gym visual.
  Details in NOTICE.md.
EOF
git clone --depth 1 https://github.com/hasaneyldrm/exercises-dataset "$tmp"
mkdir -p media/img media/gif
cp "$tmp"/images/*.jpg media/img/
cp "$tmp"/videos/*.gif media/gif/
echo "✓ $(ls media/img | wc -l) images, $(ls media/gif | wc -l) GIFs"
