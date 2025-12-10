#!/bin/bash

# Script to test agent mode chat API with curl
# First, get your auth cookie from browser DevTools:
# 1. Open DevTools (F12)
# 2. Go to Application/Storage > Cookies > http://localhost:3000
# 3. Find the cookie named "better-auth.session_token" or similar
# 4. Copy its value and paste it below

COOKIE_VALUE="${1:-YOUR_COOKIE_VALUE_HERE}"

if [ "$COOKIE_VALUE" = "YOUR_COOKIE_VALUE_HERE" ]; then
  echo "Usage: $0 <cookie-value>"
  echo ""
  echo "To get your cookie:"
  echo "1. Open browser DevTools (F12)"
  echo "2. Go to Application/Storage > Cookies > http://localhost:3000"
  echo "3. Find cookie named 'better-auth.session_token' or similar"
  echo "4. Copy its value"
  echo ""
  echo "Example: $0 '7jxaPU2DYSx3NUELVpVejIKsPK0UXbwC'"
  exit 1
fi

echo "Testing agent mode chat API..."
echo "Cookie: $COOKIE_VALUE"
echo ""

curl -v -X POST "http://localhost:3000/api/chat?stream=true" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Cookie: better-auth.session_token=$COOKIE_VALUE" \
  -d '{
    "message": "Hello, this is a test message in agent mode",
    "mode": "agent"
  }' \
  2>&1 | head -100

