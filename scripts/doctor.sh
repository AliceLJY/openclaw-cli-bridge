#!/bin/bash

echo "CLI Bridge Environment Check"
echo "===================================="
echo ""

PASS=0
WARN=0
FAIL=0

ok()   { echo "   ✅ $1"; ((PASS++)); }
warn() { echo "   ⚠️  $1"; ((WARN++)); }
fail() { echo "   ❌ $1"; ((FAIL++)); }

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Check 1: Bun
echo "📦 Checking Bun..."
if command -v bun &> /dev/null; then
    ok "Bun installed: v$(bun --version)"
else
    fail "Bun not found"
    echo "   → Install: curl -fsSL https://bun.sh/install | bash"
fi

# Check 2: Plugin manifest
echo ""
echo "📋 Checking plugin manifest..."
PLUGIN_JSON="$PROJECT_DIR/openclaw.plugin.json"
if [ -f "$PLUGIN_JSON" ]; then
    # Validate JSON syntax
    if bun -e "JSON.parse(require('fs').readFileSync('$PLUGIN_JSON','utf8'))" 2>/dev/null; then
        ok "openclaw.plugin.json valid"
    else
        fail "openclaw.plugin.json has invalid JSON"
    fi
else
    fail "openclaw.plugin.json not found"
fi

# Check 3: Entry point
echo ""
echo "📄 Checking entry point..."
if [ -f "$PROJECT_DIR/index.ts" ]; then
    ok "index.ts exists"
else
    fail "index.ts not found"
fi

# Check 4: Session store directory
echo ""
echo "💾 Checking session store..."
DEFAULT_STORE="$HOME/.openclaw-cli-bridge"
if [ -d "$DEFAULT_STORE" ]; then
    ok "Session store directory exists: $DEFAULT_STORE"
    if [ -f "$DEFAULT_STORE/state.db" ]; then
        SIZE=$(du -h "$DEFAULT_STORE/state.db" | cut -f1)
        ok "state.db exists ($SIZE)"
    else
        warn "state.db not yet created (will be created on first use)"
    fi
else
    warn "Session store directory not yet created: $DEFAULT_STORE"
    echo "   → Will be auto-created on first plugin load"
fi

# Check 5: task-api connectivity
echo ""
echo "🌐 Checking task-api connectivity..."
API_URL="${TASK_API_URL:-http://localhost:3456}"
if curl -sf --connect-timeout 3 "$API_URL/health" > /dev/null 2>&1; then
    ok "task-api reachable at $API_URL"
elif curl -sf --connect-timeout 3 "$API_URL/" > /dev/null 2>&1; then
    ok "task-api reachable at $API_URL (no /health endpoint)"
else
    warn "task-api not reachable at $API_URL"
    echo "   → Is openclaw-worker running? Check: curl $API_URL/health"
fi

# Check 6: Node.js SQLite support
echo ""
echo "🗄️  Checking SQLite support..."
if bun -e "require('node:sqlite')" 2>/dev/null; then
    ok "node:sqlite available"
else
    warn "node:sqlite not available (session persistence may not work)"
fi

# Summary
echo ""
echo "===================================="
echo "Results: ✅ $PASS passed | ⚠️  $WARN warnings | ❌ $FAIL failures"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
