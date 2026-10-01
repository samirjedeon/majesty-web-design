# Market Wall Dashboard

A full-screen market display for a wall-mounted 16:9 monitor that runs 24/7. It shows the NASDAQ Composite, S&P 500, BTC (large, in the centre), ETH, SOL, MSTR and BMNR.

**Status: phase 1. All prices are MOCK DATA.** The screen says so in an amber banner and on every panel. Real providers get plugged in once the design is approved.

## Run it

Requires Node 20 or newer. There are no npm dependencies to install.

```bash
cd market-dashboard
npm start            # → http://127.0.0.1:8080
```

* To preview the weekend/closed look, shift the clock: `DEV_CLOCK_OFFSET_HOURS=53 npm start`. Any number of hours works.
* To test resilience, stop the server while the page is open. Within about 10 seconds a "Connection lost" banner appears, and after about 45 seconds the crypto panels turn STALE. Start the server again and the page recovers by itself.

## Layout

```
config.js                 ← assets, API symbols, refresh rates, layout, market calendar
server/
  index.js                ← static files + JSON API (/api/config, /api/quotes, /api/series, /api/health)
  data-service.js         ← polls providers, caches, retries with backoff, honours rate limits
  providers/
    index.js              ← provider interface + registry
    mock.js               ← simulated data (phase 1)
public/
  index.html, styles.css  ← UI
  js/main.js              ← boot, polling, live/closed/stale rules
  js/panels.js            ← panel DOM + rendering
  js/charts.js            ← Lightweight Charts wrapper (one chart per panel, reused forever)
  js/market-hours.js      ← US session logic (shared by server and browser)
  js/format.js
  vendor/, fonts/         ← Lightweight Charts 5 + Inter, bundled locally (no CDN)
scripts/probe-providers.js ← checks that candidate APIs return all 7 symbols
kiosk/                    ← systemd unit + Chrome kiosk launcher
```

The browser only talks to the local server. Provider API keys live in `.env` on the server (see `.env.example`) and never reach the page.

### Changing a ticker

Edit the asset's entry in `config.js`: `name`, `ticker`, and the per-provider `symbols`. Then restart the server. The open screen notices the restart and reloads itself.

## Data freshness rules

| Panel badge | Meaning |
|---|---|
| ● LIVE | Updated within `staleAfter` seconds, and the provider's newest point is recent |
| DELAYED | Same as LIVE, but the provider is delayed (the footer shows by how much) |
| CLOSED / PRE-MARKET / AFTER HOURS | US asset outside regular hours, showing the last session's close |
| STALE (amber, dimmed) | No successful update recently, or the feed froze. Old prices are never shown as live. |

## Appliance setup (Linux mini-PC, e.g. Ubuntu or Raspberry Pi OS)

1. Copy this folder to `/home/kiosk/market-dashboard` and install Node 20 or newer.
2. Install the server as a service:
   `sudo cp kiosk/market-dashboard.service /etc/systemd/system/ && sudo systemctl enable --now market-dashboard`
3. Turn on automatic desktop login for the `kiosk` user, then:
   `mkdir -p ~/.config/autostart && cp kiosk/market-dashboard.desktop ~/.config/autostart/`
4. In the BIOS, enable *power on after AC loss* so the machine boots when the power comes back.

The boot sequence is: power on → boot → auto-login → server starts → Chrome opens full-screen → dashboard loads.

The page also does a full reload once a day at 04:00 ET (`display.dailyReloadAt`), holds a screen wake-lock, and hides the cursor.
