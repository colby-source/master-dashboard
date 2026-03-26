#!/bin/bash
PROGRESS_FILE="c:/Users/colby/Repos/master-dashboard/data/family-office-scrape/phase3-progress.json"
TOTAL=7019

while true; do
  if [ ! -f "$PROGRESS_FILE" ]; then
    echo "Progress file gone — Phase 3 complete!"
    break
  fi
  
  completed=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PROGRESS_FILE','utf-8')).completed)")
  echo "$(date +%H:%M:%S) — $completed/$TOTAL"
  
  if [ "$completed" -ge "$TOTAL" ]; then
    echo "Phase 3 complete!"
    break
  fi
  
  sleep 60
done

echo "Shutting down in 30 seconds..."
sleep 30
shutdown /s /t 0
