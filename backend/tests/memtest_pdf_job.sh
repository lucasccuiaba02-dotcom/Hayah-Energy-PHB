#!/bin/bash
# Mede pico de RSS do worker uvicorn durante um job de PDF (uso: memtest_pdf_job.sh <project_id> <diario|avanco>)
API_URL=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)
TOKEN=$(curl -s -X POST "$API_URL/api/auth/login" -H "Content-Type: application/json" -d '{"email":"lucasc.cuiaba02@gmail.com","password":"Hayah$152610"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
PID=$1; KIND=${2:-diario}
WPID=$(ps -eo pid,cmd | grep "multiprocessing.spawn" | grep -v grep | awk '{print $1}' | head -1)
echo "worker pid $WPID idle RSS $(( $(ps -o rss= -p $WPID) / 1024 )) MB"
rm -f /tmp/rss.log
( while true; do ps -o rss= -p $WPID >> /tmp/rss.log; sleep 0.4; done ) &
SAMPLER=$!
START=$(date +%s)
if [ "$KIND" = "diario" ]; then
  JOB=$(curl -s -X POST "$API_URL/api/operacional/daily-log/$PID/job" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"max_photos":500}')
else
  IDS=$(curl -s "$API_URL/api/projects/$PID/avanco/photos" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps([p['id'] for p in d['photos']]))")
  JOB=$(curl -s -X POST "$API_URL/api/projects/$PID/avanco/pdf/job" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"photo_ids\":$IDS}")
fi
echo "$JOB" | head -c 160; echo
JID=$(echo "$JOB" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
for i in $(seq 1 150); do
  sleep 2
  ST=$(curl -s "$API_URL/api/pdf-jobs/$JID" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['status'], d['pct'], d['message'], d.get('error',''), d['size'])")
  case "$ST" in done*|error*) echo "$ST"; break;; esac
done
echo "elapsed $(( $(date +%s) - START ))s"
kill $SAMPLER 2>/dev/null
echo "PEAK RSS MB $(( $(sort -n /tmp/rss.log | tail -1) / 1024 ))  final RSS MB $(( $(ps -o rss= -p $WPID) / 1024 ))"
