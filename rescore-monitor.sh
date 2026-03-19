#!/bin/bash
cd "c:/Users/colby/Master Dashboard"

while true; do
  # Check if server is up
  stats=$(curl -s http://localhost:3001/api/enrichment/stats 2>/dev/null)
  if [ -z "$stats" ]; then
    echo "$(date): Server is down. Restarting..."
    npx tsx server/index.ts > /tmp/server.log 2>&1 &
    sleep 10
    # Re-trigger bulk rescore
    echo "$(date): Re-triggering bulk rescore..."
    curl -s -X POST http://localhost:3001/api/enrichment/leads/bulk-rescore \
      -H "Content-Type: application/json" \
      -d '{"batch_size":20,"delay_ms":300}'
    echo ""
    sleep 60
    continue
  fi

  remaining=$(echo "$stats" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const s=JSON.parse(d);console.log(s.scoreVeryLow)}catch{console.log('-1')}})" 2>/dev/null)
  hot=$(echo "$stats" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const s=JSON.parse(d);console.log(s.scoreHigh)}catch{console.log('?')}})" 2>/dev/null)
  warm=$(echo "$stats" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const s=JSON.parse(d);console.log(s.scoreMedium)}catch{console.log('?')}})" 2>/dev/null)

  echo "$(date): Hot=$hot Warm=$warm Remaining=$remaining"

  if [ "$remaining" = "0" ]; then
    echo "$(date): ALL SCORING COMPLETE! Shutting down in 60 seconds..."
    shutdown.exe /s /t 60
    exit 0
  fi

  sleep 60
done
