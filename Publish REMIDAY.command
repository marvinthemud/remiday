#!/bin/bash
# Double-click to publish any changes in this folder to the live REMIDAY site.
cd "$(dirname "$0")" || exit 1
if [ -z "$(git status --porcelain)" ]; then
  echo "Nothing new to publish. The live site is already up to date."
else
  git add -A
  git commit -q -m "Update $(date '+%b %d %H:%M')"
  if git push -q; then
    echo "Published. The live site updates in about a minute."
    echo "https://marvinthemud.github.io/remiday/"
  else
    echo "Push failed. Check your internet connection or GitHub token."
  fi
fi
echo
read -n 1 -s -r -p "Press any key to close this window."
