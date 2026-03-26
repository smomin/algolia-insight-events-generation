#!/usr/bin/env bash
# =============================================================================
# Algolia Insights Agent Dashboard — Setup Script
# =============================================================================
# This script bootstraps the full development environment:
#   1. Validates prerequisites (Docker, Node.js, npm)
#   2. Starts a Couchbase Server container
#   3. Waits for Couchbase to be healthy
#   4. Initialises the cluster, creates an admin user, and creates the bucket
#   5. Copies .env.local.example → .env and generates a secure ENCRYPTION_SECRET
#   6. Runs npm install
#
# Usage:
#   chmod +x scripts/setup.sh
#   ./scripts/setup.sh
#
# Re-running is safe: existing containers and .env files are preserved.
# To start completely fresh: docker rm -f couchbase-algolia && rm .env
# =============================================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
step()    { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }

# ── Configuration ─────────────────────────────────────────────────────────────
CONTAINER_NAME="couchbase-algolia"
COUCHBASE_IMAGE="couchbase:community"
COUCHBASE_URL="couchbase://localhost"
COUCHBASE_USERNAME="Administrator"
COUCHBASE_PASSWORD="password"
COUCHBASE_BUCKET="algolia-insights"
CB_WEB_PORT=8091
CB_API="http://localhost:${CB_WEB_PORT}"

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   Algolia Insights Agent Dashboard — Setup               ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: Prerequisites ─────────────────────────────────────────────────────
step "Checking prerequisites"

check_command() {
  if ! command -v "$1" &>/dev/null; then
    error "$1 is not installed or not in PATH."
    echo "  → Install from: $2"
    exit 1
  fi
  success "$1 found: $(command -v "$1")"
}

check_command docker  "https://docs.docker.com/get-docker/"
check_command node    "https://nodejs.org/"
check_command npm     "https://nodejs.org/"

NODE_MAJOR=$(node -e "process.stdout.write(process.version.replace('v','').split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node.js 18+ is required (found v$(node --version)). Please upgrade."
  exit 1
fi
success "Node.js version: $(node --version)"

if ! docker info &>/dev/null; then
  error "Docker daemon is not running. Start Docker Desktop and retry."
  exit 1
fi
success "Docker daemon is running"

# ── Step 2: Couchbase container ───────────────────────────────────────────────
step "Setting up Couchbase Server"

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  CONTAINER_STATE=$(docker inspect --format='{{.State.Status}}' "$CONTAINER_NAME")
  if [ "$CONTAINER_STATE" = "running" ]; then
    success "Container '${CONTAINER_NAME}' is already running — skipping docker run"
  else
    warn "Container '${CONTAINER_NAME}' exists but is ${CONTAINER_STATE}. Starting it…"
    docker start "$CONTAINER_NAME"
    success "Container started"
  fi
else
  info "Pulling image ${COUCHBASE_IMAGE} (this may take a minute)…"
  docker pull "$COUCHBASE_IMAGE" --quiet

  info "Starting Couchbase container…"
  docker run -d \
    --name "$CONTAINER_NAME" \
    -p 8091-8097:8091-8097 \
    -p 11210:11210 \
    -p 11211:11211 \
    "$COUCHBASE_IMAGE" >/dev/null

  success "Container '${CONTAINER_NAME}' started"
fi

# ── Step 3: Wait for Couchbase web UI ─────────────────────────────────────────
step "Waiting for Couchbase to be ready"

MAX_WAIT=120
ELAPSED=0
INTERVAL=3

echo -n "  Waiting for ${CB_API}/ui/index.html"
until curl -sf "${CB_API}/ui/index.html" -o /dev/null 2>/dev/null; do
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo ""
    error "Couchbase did not become ready within ${MAX_WAIT}s."
    error "Check container logs: docker logs ${CONTAINER_NAME}"
    exit 1
  fi
  echo -n "."
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done
echo " ready!"
success "Couchbase web UI is up at ${CB_API}"

# ── Step 4: Initialise cluster ────────────────────────────────────────────────
step "Initialising Couchbase cluster"

# Check if cluster is already initialised by testing /pools/default
HTTP_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" \
  -u "${COUCHBASE_USERNAME}:${COUCHBASE_PASSWORD}" \
  "${CB_API}/pools/default" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
  success "Cluster already initialised — skipping"
else
  info "Initialising new cluster…"

  # Initialise node
  curl -sf "${CB_API}/nodes/self/controller/settings" \
    -d "path=%2Fopt%2Fcouchbase%2Fvar%2Flib%2Fcouchbase%2Fdata" \
    -d "index_path=%2Fopt%2Fcouchbase%2Fvar%2Flib%2Fcouchbase%2Fdata" \
    -o /dev/null

  # Set cluster name and services
  curl -sf "${CB_API}/pools/default" \
    -d "clusterName=algolia-insights" \
    -d "memoryQuota=512" \
    -o /dev/null

  # Enable services (data, index, query, fts)
  curl -sf "${CB_API}/node/controller/setupServices" \
    -d "services=kv%2Cindex%2Cn1ql%2Cfts" \
    -o /dev/null

  # Set admin credentials
  curl -sf "${CB_API}/settings/web" \
    -d "username=${COUCHBASE_USERNAME}" \
    -d "password=${COUCHBASE_PASSWORD}" \
    -d "port=SAME" \
    -o /dev/null

  success "Cluster initialised with admin user '${COUCHBASE_USERNAME}'"
fi

# ── Step 5: Create bucket ─────────────────────────────────────────────────────
step "Setting up bucket '${COUCHBASE_BUCKET}'"

BUCKET_EXISTS=$(curl -sf \
  -u "${COUCHBASE_USERNAME}:${COUCHBASE_PASSWORD}" \
  "${CB_API}/pools/default/buckets/${COUCHBASE_BUCKET}" \
  -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")

if [ "$BUCKET_EXISTS" = "200" ]; then
  success "Bucket '${COUCHBASE_BUCKET}' already exists — skipping"
else
  info "Creating bucket '${COUCHBASE_BUCKET}'…"
  HTTP=$(curl -sf \
    -u "${COUCHBASE_USERNAME}:${COUCHBASE_PASSWORD}" \
    "${CB_API}/pools/default/buckets" \
    -d "name=${COUCHBASE_BUCKET}" \
    -d "bucketType=couchbase" \
    -d "ramQuota=256" \
    -d "replicaNumber=0" \
    -d "flushEnabled=1" \
    -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")

  if [ "$HTTP" = "202" ] || [ "$HTTP" = "200" ]; then
    success "Bucket '${COUCHBASE_BUCKET}' created (RAM quota: 256 MB)"
  else
    warn "Bucket creation returned HTTP ${HTTP}. It may already exist or the cluster needs more time."
    warn "Collections and indexes are created automatically by the app on first startup."
  fi
fi

# ── Step 6: Environment file ───────────────────────────────────────────────────
step "Configuring environment variables"

ENV_FILE=".env"
ENV_EXAMPLE=".env.local.example"

if [ ! -f "$ENV_EXAMPLE" ]; then
  error "Could not find ${ENV_EXAMPLE}. Run this script from the project root."
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  warn "${ENV_FILE} already exists — skipping copy"
else
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  success "Copied ${ENV_EXAMPLE} → ${ENV_FILE}"

  # Generate a secure ENCRYPTION_SECRET (64 hex chars = 32 bytes)
  if command -v openssl &>/dev/null; then
    SECRET=$(openssl rand -hex 32)
  else
    # Fallback: use /dev/urandom
    SECRET=$(head -c 32 /dev/urandom | od -A n -t x1 | tr -d ' \n')
  fi

  # Replace the placeholder in .env
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|change-me-to-a-strong-random-secret-string|${SECRET}|" "$ENV_FILE"
  else
    sed -i "s|change-me-to-a-strong-random-secret-string|${SECRET}|" "$ENV_FILE"
  fi

  success "Generated ENCRYPTION_SECRET (64-char hex) and wrote to ${ENV_FILE}"
  info "All other values in ${ENV_FILE} match the defaults expected by the Docker setup."
fi

# ── Step 7: npm install ────────────────────────────────────────────────────────
step "Installing Node.js dependencies"

if [ -d "node_modules" ] && [ -f "package-lock.json" ]; then
  info "node_modules already present — running npm install to sync…"
fi

npm install --prefer-offline 2>&1 | tail -5
success "npm install complete"

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║   Setup complete!                                        ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo ""
echo -e "  1. ${CYAN}npm run dev${NC}                   — start the development server"
echo -e "  2. Open ${CYAN}http://localhost:3000${NC}    — open the agent dashboard"
echo -e "  3. Click ${BOLD}⚙ App Settings${NC}          — add your Algolia + LLM credentials"
echo ""
echo -e "  ${BOLD}Couchbase admin UI:${NC}"
echo -e "  → ${CYAN}${CB_API}${NC}"
echo -e "  → Username: ${BOLD}${COUCHBASE_USERNAME}${NC}  Password: ${BOLD}${COUCHBASE_PASSWORD}${NC}"
echo ""
echo -e "  ${YELLOW}Note:${NC} API credentials (Algolia App ID, Search API Key, LLM API Key)"
echo -e "  are ${BOLD}not${NC} stored in .env. Enter them in the in-app ⚙ Settings panel"
echo -e "  where they will be encrypted with AES-256-GCM and stored in Couchbase."
echo ""
