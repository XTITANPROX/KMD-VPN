#!/usr/bin/env bash
# KALFETELA — one-shot Cloudflare deployer.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=xxxx CLOUDFLARE_ACCOUNT_ID=yyyy \
#     bash deploy.sh [worker-name] [TLD or zone]
#
# What it does:
#   1. verifies credentials
#   2. creates D1, KV, R2, Queue if missing
#   3. patches wrangler.toml with the returned IDs
#   5. applies D1 migrations
#   6. runs `wrangler deploy`
#
# Re-runnable: existing resources are detected and reused.

set -euo pipefail

WORKER_NAME="${1:-kalfetela}"
ZONE_HOST="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "❌ CLOUDFLARE_API_TOKEN is required"; exit 1
fi
if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "❌ CLOUDFLARE_ACCOUNT_ID is required"; exit 1
fi

export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
CF_API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")

step() { echo; echo "▶ $*"; }
ok()   { echo "  ✅ $*"; }
die()  { echo "  ❌ $*"; exit 1; }

############################ 1. verify ############################
step "Verifying Cloudflare credentials"
ME=$(curl -s "${AUTH[@]}" "$CF_API/user/tokens/verify")
echo "$ME" | grep -q '"success":true' || die "token verification failed"
ok "token OK"

############################ 2. D1 ############################
D1_NAME="kalfetela"
step "Ensuring D1 database '$D1_NAME' exists"
D1_LIST=$(curl -s "${AUTH[@]}" "$CF_API/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database")
D1_ID=$(echo "$D1_LIST" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const db=(j.result||[]).find(x=>x.name==='$D1_NAME');process.stdout.write(db?db.uuid:'')})")
if [[ -z "$D1_ID" ]]; then
  D1_R=$(curl -s -X POST "${AUTH[@]}" "$CF_API/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database" -d "{\"name\":\"$D1_NAME\"}")
  D1_ID=$(echo "$D1_R" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);if(!j.success){console.error(JSON.stringify(j.errors));process.exit(1)}process.stdout.write(j.result.uuid)})")
  ok "created D1 $D1_ID"
else
  ok "existing D1 $D1_ID"
fi

############################ 3. KV ############################
KV_NAME="kalfetela-kv"
step "Ensuring KV namespace '$KV_NAME' exists"
KV_LIST=$(curl -s "${AUTH[@]}" "$CF_API/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces")
KV_ID=$(echo "$KV_LIST" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const ns=(j.result||[]).find(x=>x.title==='$KV_NAME');process.stdout.write(ns?ns.id:'')})")
if [[ -z "$KV_ID" ]]; then
  KV_R=$(curl -s -X POST "${AUTH[@]}" "$CF_API/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces" -d "{\"title\":\"$KV_NAME\"}")
  KV_ID=$(echo "$KV_R" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);if(!j.success){console.error(JSON.stringify(j.errors));process.exit(1)}process.stdout.write(j.result.id)})")
  ok "created KV $KV_ID"
else
  ok "existing KV $KV_ID"
fi

############################ 4. R2 (SKIPPED — paid plan) ########
step "Skipping R2 (free plan; code works without it)"

############################ 5. Queue ############################
Q_NAME="kalfetela-writes"
step "Ensuring Queue '$Q_NAME' exists"
Q_LIST=$(curl -s "${AUTH[@]}" "$CF_API/accounts/$CLOUDFLARE_ACCOUNT_ID/queues")
if echo "$Q_LIST" | grep -q "\"queue_name\":\"$Q_NAME\""; then
  ok "queue exists"
else
  curl -s -X POST "${AUTH[@]}" "$CF_API/accounts/$CLOUDFLARE_ACCOUNT_ID/queues" -d "{\"queue_name\":\"$Q_NAME\"}" >/dev/null
  ok "created queue"
fi

############################ 6. patch wrangler.toml ############################
step "Patching wrangler.toml"
cp wrangler.toml wrangler.toml.bak
node -e "
const fs=require('fs');
let s=fs.readFileSync('wrangler.toml','utf8');
s=s.replace(/name = \".*?\"/, 'name = \"$WORKER_NAME\"');
s=s.replace(/database_id = \"REPLACE_WITH_D1_ID\"/, 'database_id = \"$D1_ID\"');
s=s.replace(/id = \"REPLACE_WITH_KV_ID\"/, 'id = \"$KV_ID\"');
fs.writeFileSync('wrangler.toml',s);
"
ok "wrangler.toml updated"

############################ 7. secrets ############################
step "Setting PANEL_SECRET"
if [[ -z "${PANEL_SECRET:-}" ]]; then
  PANEL_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "  → generated a new PANEL_SECRET"
fi
echo "$PANEL_SECRET" | npx wrangler secret put PANEL_SECRET >/dev/null


############################ 8. migrations ############################
step "Applying D1 migrations"
npx wrangler d1 migrations apply "$D1_NAME" --remote

############################ 9. deploy ############################
step "Deploying Worker"
npx wrangler deploy

echo
echo "🎉 Deployment complete."
echo "   Panel: https://$WORKER_NAME.<your-subdomain>.workers.dev/panel"
echo "   PANEL_SECRET configured securely."
if [[ -n "$ZONE_HOST" ]]; then
  echo "   Remember to add a custom domain route for $ZONE_HOST in the Cloudflare dashboard."
fi
