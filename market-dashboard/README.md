# Market Wall Dashboard

A full-screen market display for a wall-mounted 16:9 monitor that runs 24/7. It shows the NASDAQ Composite, S&P 500, BTC (large, in the centre), ETH, SOL, MSTR and BMNR.

**Data sources (live by default):**

| Assets | Provider | Cost | Freshness |
|---|---|---|---|
| BTC, ETH, SOL | Coinbase Exchange public API | Free, no key | Real-time, updates every 5 s |
| NASDAQ Composite (^IXIC), S&P 500 (^GSPC), MSTR, BMNR | Yahoo Finance chart API | Free, no key | Polled every 15 s. Each panel's footer shows the timestamp of the data it is showing. |

Yahoo's API is unofficial and can rate-limit or change without notice. When it does, the panels go STALE or NO DATA instead of showing old numbers. Moving to a paid provider means adding one file in `server/providers/` and changing one line in `config.js`.

## Run it

Requires Node 20 or newer. There are no npm dependencies to install.

```bash
git clone https://github.com/samirjedeon/majesty-web-design.git
cd majesty-web-design && git checkout market-dashboard
cd market-dashboard
npm run probe        # optional: checks all 7 symbols are reachable from this machine
npm start            # → open http://127.0.0.1:8080
```

* `npm test` runs the provider parser tests. They don't need the network.
* For simulated data instead (design work, offline): `PROVIDER_CRYPTO=mock PROVIDER_US=mock npm start`. The screen is then labelled MOCK DATA.
* To preview the weekend/closed look with mock data: add `DEV_CLOCK_OFFSET_HOURS=53` to the mock command. Any number of hours works.
* To test resilience, stop the server while the page is open. Within about 10 seconds a "Connection lost" banner appears, and stale panels turn amber. Start the server again and the page recovers by itself.

## Layout

```
config.js                 ← assets, API symbols, refresh rates, layout, market calendar
server/
  index.js                ← static files + JSON API (/api/config, /api/quotes, /api/series, /api/health)
  data-service.js         ← polls providers, caches, retries with backoff, honours rate limits
  providers/
    index.js              ← provider interface + registry
    coinbase.js           ← crypto (live)
    yahoo.js              ← indexes + stocks (live)
    mock.js               ← simulated data
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
| NO DATA | The provider has never answered since startup. The footer names it, and the server keeps retrying. |

## Appliance setup (Linux mini-PC, e.g. Ubuntu or Raspberry Pi OS)

1. Copy this folder to `/home/kiosk/market-dashboard` and install Node 20 or newer.
2. Install the server as a service:
   `sudo cp kiosk/market-dashboard.service /etc/systemd/system/ && sudo systemctl enable --now market-dashboard`
3. Turn on automatic desktop login for the `kiosk` user, then:
   `mkdir -p ~/.config/autostart && cp kiosk/market-dashboard.desktop ~/.config/autostart/`
4. In the BIOS, enable *power on after AC loss* so the machine boots when the power comes back.

The boot sequence is: power on → boot → auto-login → server starts → Chrome opens full-screen → dashboard loads.

The page also does a full reload once a day at 04:00 ET (`display.dailyReloadAt`), holds a screen wake-lock, and hides the cursor.
