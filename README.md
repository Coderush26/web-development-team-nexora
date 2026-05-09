# Fleet Crisis Ops — Command System

Real-time maritime fleet command & control for crisis operations in the Strait of Hormuz.

## Quick Start

### Docker (recommended for judging)
```bash
cp .env.example .env
# Add your OpenAI key to .env (optional — falls back to rule-based NLP)
docker compose up --build
```
Open: http://localhost (Command) or http://localhost (Captain — use a second tab, select Captain role)

### Local Development
```bash
# Terminal 1 — Backend
cd backend && npm install && npm start

# Terminal 2 — Frontend
cd frontend && npm install && npm run dev
```
Frontend: http://localhost:5173 · Backend WS: ws://localhost:3001

## Environment Variables
| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | No | GPT-4o-mini for distress NLP & AI fleet advisor. Falls back to rule-based parser if absent. |
| `PORT` | No | Backend port (default: 3001) |

## Architecture
```
backend/
  src/
    server.js      ← Express + WebSocket server (persistent connections, no polling)
    simulator.js   ← 1Hz fleet simulation engine (15 ships, all state computed live)
    router.js      ← A* grid routing over navigable water polygon with zone avoidance
    weather.js     ← Open-Meteo free-tier API (live weather data, cached 5min)
    ai.js          ← OpenAI NLP distress analysis + AI fleet advisor (with rule-based fallback)
    playback.js    ← Ring-buffer state recorder (120 snapshots × 30s = 1 hour)
    data/
      fleet.json   ← 15 ships, 8 ports, navigable water polygon, bounding box

frontend/
  src/
    store/fleetStore.js   ← Zustand state + WebSocket client (auto-reconnect)
    components/
      LoginPage.jsx       ← Role selection (Command / Captain)
      CommandView.jsx      ← Full fleet view, zone drawing, directives, AI advisor
      CaptainView.jsx      ← Single ship view, distress calls, assistance requests
      FleetMap.jsx         ← Leaflet + smooth interpolation (requestAnimationFrame)
      DirectiveModal.jsx   ← Multi-route reroute with weather tradeoffs
      ShipList.jsx         ← Filterable fleet sidebar
      ShipDetailPanel.jsx  ← Ship details, fuel bar, distress analysis display
      AlertPanel.jsx       ← Alert feed with acknowledge buttons
      AIAdvisor.jsx        ← Proactive AI suggestions for Command
      Timeline.jsx         ← Playback scrubber with event markers
```

## Core Feature Checklist
- [x] 15 ships simulated at 1Hz — `simulator.js` runs `setInterval` at 1000ms
- [x] WebSocket real-time sync — persistent `ws` connections, < 500ms delivery
- [x] Geofence breach alerts — `pointInPolygon` check every tick, fires within 1 second
- [x] Proximity warnings — Haversine distance on all ship pairs, triggers at < 2km
- [x] Smooth interpolation — `requestAnimationFrame` 60fps client-side, 950ms ease
- [x] Role-based interfaces — Command (full fleet + zones) / Captain (single ship)
- [x] Draw restricted zones at runtime — Command-only `leaflet-draw` polygon tool
- [x] A* routing with zone avoidance — grid over navigable water polygon
- [x] Auto-reroute on zone intersection — `pathIntersectsZone` triggers `_reroute()`
- [x] Auto-reroute when zone drawn on ship — `pointInPolygon` detects + reroutes out
- [x] Stranded detection — no valid path → status `stranded` + critical alert
- [x] Insufficient fuel flag — `_checkFuelPrediction()` flags but keeps ship moving
- [x] Out of fuel — ship stops when `fuel <= 0`, fires critical alert
- [x] Real weather data — Open-Meteo free API, per-ship every 60s
- [x] 30% fuel penalty in adverse weather — `ADVERSE_MULT = 1.30` applied per km
- [x] Weather-aware routing — A* grid costs weighted by weather severity
- [x] Captain directives — ACCEPT (adopts course) / ESCALATE_DISTRESS (AI analyzes)
- [x] Directive broadcast — response reaches everyone connected immediately
- [x] AI NLP distress analysis — GPT-4o-mini extracts severity, injuries, damage, needs
- [x] Rule-based fallback — works without API key via keyword matching
- [x] Audible alerts — Web Audio API tone for critical events
- [x] Visual alerts — toast notifications, pulsing ship icons, distress rings on map
- [x] Alert acknowledgement — alerts stay active until explicitly acknowledged
- [x] Playback timeline — ring buffer, 1hr at 30s resolution, scrubber UI with event markers
- [x] Fully Dockerized — `docker compose up` brings up backend + frontend (nginx)

## Bonus Features (Tiebreakers)
- [x] **Multiple route options** — Generate fastest / balanced / weather-safe paths with distance, fuel cost, and risk level. Operator picks before confirming reroute.
- [x] **Ship-to-ship assistance** — Captain can request fuel, medical, escort, or cargo offload from nearby ships. Request reaches target captain's interface.
- [x] **Predictive alerts** — Fuel prediction runs every tick: "Ship will run out of fuel X tons short of port." Fires warning before ship actually runs dry.
- [x] **AI fleet advisor** — Proactive suggestions to Command with reasoning (which ship to reroute, who could send aid). Operator can act on or dismiss advice.

## Documented Assumptions
Per the spec: *"If the spec didn't say something, document the assumption you made."*

1. **Fuel units**: Fuel is measured in tons as provided in `fleet.json`. Each ship's initial fuel value is treated as the maximum capacity for that voyage.
2. **Base fuel consumption**: 0.8 tons per km traveled. This rate is multiplied by 1.3× during adverse weather (satisfying the 30% penalty requirement).
3. **Ship speed**: Ships travel at their configured speed regardless of weather. Adverse weather increases fuel burn, not reduces speed. Weather avoidance requires an explicit reroute directive from Command.
4. **A* grid resolution**: 0.08° per cell (~8km). This provides sufficient granularity for zone avoidance in the Strait of Hormuz operational area while keeping pathfinding fast.
5. **Navigable water**: The provided `navigableWater` polygon is used as-is. Ship starting positions at polygon boundaries are given a 2-cell tolerance radius to prevent false "stranded" states.
6. **Arrival threshold**: A ship is considered "arrived" when within 1.5km of its destination port.
7. **Proximity alert cooldown**: Proximity warnings fire once per 30 seconds per ship pair to avoid alert spam. The cooldown resets when ships separate beyond 2km.
8. **Weather data**: Pulled from Open-Meteo (free tier, no API key required). Cached for 5 minutes per ~25km location bucket. WMO weather codes 51+ and wind > 45 km/h are classified as adverse.
9. **Playback**: Replays ship positions and zone states. Does not reconstruct full server state at arbitrary timestamps (per spec: "We don't need full state reconstruction").
10. **AI fallback**: If no `OPENAI_API_KEY` is provided, the system uses a comprehensive rule-based NLP parser that extracts severity, issue type, injuries, and assistance needs from keyword analysis. All features remain functional.
11. **Multiple clients**: The WebSocket server has no connection limit. State is broadcast identically to all connected clients from a single authoritative backend source.
12. **Routing fallback**: If A* cannot find a path through the grid (all cells blocked), the router returns a direct straight-line path as a last resort. Only if the router returns null does the ship enter "stranded" status.
