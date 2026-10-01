#!/usr/bin/env bash
# Launches Chrome/Chromium full-screen on the dashboard. Run from the desktop
# session's autostart (see README). Waits for the local server, then relaunches
# the browser if it ever exits.
URL="${DASHBOARD_URL:-http://127.0.0.1:8080/}"
BROWSER="$(command -v chromium || command -v chromium-browser || command -v google-chrome)"

# Keep the screen on.
xset s off -dpms s noblank 2>/dev/null || true

until curl -fsS "${URL}api/health" >/dev/null 2>&1; do sleep 2; done

while true; do
  "$BROWSER" --kiosk --noerrdialogs --disable-infobars --no-first-run \
    --disable-session-crashed-bubble --disable-features=Translate \
    --check-for-update-interval=31536000 --overscroll-history-navigation=0 \
    --autoplay-policy=no-user-gesture-required "$URL"
  sleep 3
done
