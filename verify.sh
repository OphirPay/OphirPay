#!/usr/bin/env bash
cd /home/automaton/work/ophir || exit 1
set +e

echo "=== remote (sanitized) ==="
git remote -v | sed -E 's#(https://)[^@]*@#\1***@#g'
SLUG=$(git remote get-url origin 2>/dev/null | sed -E 's#.*github.com[:/]##; s#\.git$##')
echo "SLUG=$SLUG"

echo "=== open issues mentioning dead-letter / webhook / bounty ==="
if [ -n "$SLUG" ]; then
  curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
    "https://api.github.com/repos/$SLUG/issues?state=open&per_page=100" \
  | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
 try{const j=JSON.parse(d);
  if(!Array.isArray(j)){console.log("API resp:",JSON.stringify(j).slice(0,300));return;}
  const hits=j.filter(i=>/dead[- ]?letter|webhook|retry|reliab|dlq/i.test(i.title));
  console.log("open issues:",j.length,"| matching:",hits.length);
  hits.slice(0,10).forEach(i=>console.log(i.number,"|",i.title,"| labels:",i.labels.map(l=>l.name).join(",")));
 }catch(e){console.log("parse err",e.message,d.slice(0,200));}
});'
fi

echo "=== ensure dev toolchain ==="
[ -d node_modules/@types/node ] || npm i --no-save --ignore-scripts @types/node@22 2>&1 | tail -2
[ -x node_modules/.bin/vitest ] || npm i --no-save --ignore-scripts vitest 2>&1 | tail -2

echo "=== prisma client generate ==="
./node_modules/.bin/prisma generate 2>&1 | tail -2

echo "=== vitest (my test) ==="
./node_modules/.bin/vitest run tests/webhook-dead-letter.test.ts --reporter=basic 2>&1 | tail -25

echo "=== tsc limited to src/lib + src/app/api/webhooks ==="
./node_modules/.bin/tsc --noEmit --skipLibCheck --jsx preserve --module esnext --moduleResolution bundler \
  --target es2022 --strict --paths '{"@/*":["./src/*"]}' --baseUrl . \
  src/lib/webhook-dead-letter.ts src/lib/webhook-dead-letter-service.ts \
  src/lib/webhook-dead-letter-metrics.ts src/lib/fetch-with-timeout.ts \
  src/lib/webhook-target-resolver.ts src/lib/webhook-deliver.ts 2>&1 | head -20
echo "=== done ==="
