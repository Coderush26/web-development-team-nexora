'use strict';
const EventEmitter = require('events');
const fleetData = require('./data/fleet.json');
const { computeRoute, computeMultipleRoutes, haversine, pointInPolygon, pathIntersectsZone, estimateFuelForPath, pathDistance } = require('./router');
const { fetchWeather } = require('./weather');

const KNOTS_TO_KMH = 1.852;
const FUEL_PER_KM = 0.8;   // tons per km base consumption
const ADVERSE_MULT = 1.30;  // 30% penalty
const PROXIMITY_KM = 2.0;
const TICK_MS = 1000;  // 1 Hz (required by spec)
const SIM_SPEED = 50;  // 50x speed multiplier for demo

class FleetSimulator extends EventEmitter {
  constructor() {
    super();

    // Build port lookup by id
    const portsMap = {};
    (fleetData.ports || []).forEach(p => {
      portsMap[p.id] = { lat: p.position[0], lng: p.position[1], name: p.name, id: p.id };
    });

    this.ports = Object.values(portsMap);

    this.ships = (fleetData.fleet || fleetData.ships).map(s => {
      const dest = portsMap[s.destination] || { lat: 25.2, lng: 55.3, name: s.destination, id: s.destination };
      return {
        id: s.shipId || s.id,
        name: s.name,
        lat: s.position ? s.position[0] : s.lat,
        lng: s.position ? s.position[1] : s.lng,
        speed: s.speed,
        heading: s.heading,
        destination: dest.name,
        destinationId: dest.id,
        destinationLat: dest.lat,
        destinationLng: dest.lng,
        fuel: s.fuel,           // tons — kept as-is
        maxFuel: s.fuel,        // initial fuel = assumed max for this voyage
        cargo: s.cargo,
        status: s.status || 'normal',
        path: [],
        pathIndex: 0,
        weather: { isAdverse: false, description: 'Clear', windSpeed: 0, weatherCode: 0 },
        inZones: new Set(),
        distressAnalysis: null,
        predictedFuelShortfall: false,
        lastUpdate: Date.now(),
        originalSpeed: s.speed,
      };
    });

    this.zones = [];
    this.alerts = [];
    this.navigablePolygon = fleetData.navigableWater;
    this.bbox = fleetData.boundingBox;
    this.tickCount = 0;
    this.interval = null;
    this._weatherCostFn = null;
    this._proximityCooldowns = new Map(); // key -> timestamp of last alert
  }

  // ── Startup ────────────────────────────────────────────────────────────────
  _initRoutes() {
    for (const ship of this.ships) {
      this._reroute(ship);
    }
  }

  start() {
    // Compute initial routes immediately (sync, no weather cost yet)
    this._initRoutes();
    // Start ticking
    this.interval = setInterval(() => this._tick(), TICK_MS);
    // Refresh weather every 5 minutes
    setInterval(() => this._refreshWeatherCostFn(), 5 * 60 * 1000);
    // Initial weather pull in background - reroute after it arrives
    this._refreshWeatherCostFn().then(() => {
      // Reroute all ships with weather data now available
      for (const ship of this.ships) {
        if (ship.status === 'normal' || ship.status === 'rerouting') this._reroute(ship);
      }
    }).catch(() => { });
  }

  stop() { if (this.interval) clearInterval(this.interval); }

  // ── Weather cost function (for routing) ────────────────────────────────────
  async _refreshWeatherCostFn() {
    try {
      const weatherMap = new Map();
      // Sample weather at each ship position
      await Promise.allSettled(this.ships.map(async s => {
        const w = await fetchWeather(s.lat, s.lng);
        const bk = `${Math.round(s.lat * 2) / 2}_${Math.round(s.lng * 2) / 2}`;
        weatherMap.set(bk, w.isAdverse ? ADVERSE_MULT : 1.0);
      }));
      this._weatherCostFn = (lat, lng) => {
        const key = `${Math.round(lat * 2) / 2}_${Math.round(lng * 2) / 2}`;
        return weatherMap.get(key) || 1.0;
      };
      this._weatherMap = weatherMap;
    } catch { /* keep old */ }
  }

  // ── Main tick ──────────────────────────────────────────────────────────────
  async _tick() {
    this.tickCount++;
    const now = Date.now();

    for (const ship of this.ships) {
      if (ship.status === 'arrived' || ship.status === 'stopped') continue;
      if (ship.fuel <= 0) {
        if (ship.status !== 'out_of_fuel') {
          ship.status = 'out_of_fuel'; ship.fuel = 0;
          this._addAlert('FUEL_EMPTY', ship, `⛽ ${ship.name} has run out of fuel!`, 'critical');
        }
        continue;
      }

      // Refresh weather per-ship every 60s
      if (this.tickCount % 60 === 0) {
        fetchWeather(ship.lat, ship.lng).then(w => { ship.weather = w; }).catch(() => { });
      }

      this._advanceShip(ship, (TICK_MS / 1000) * SIM_SPEED);
      this._checkArrival(ship);
      this._checkGeofence(ship);
      this._checkFuelPrediction(ship);
      this._checkZoneApproach(ship);
    }

    this._checkProximity();

    this.emit('update', {
      ships: this.ships.map(s => this._serialize(s)),
      zones: this.zones,
      alerts: this.alerts.slice(-50),
      timestamp: now,
    });
  }

  // ── Ship movement ──────────────────────────────────────────────────────────
  _advanceShip(ship, dtSec) {
    if (!ship.path || ship.path.length < 2 || ship.pathIndex >= ship.path.length - 1) return;
    const speedKmh = ship.speed * KNOTS_TO_KMH;
    const fuelMult = ship.weather?.isAdverse ? ADVERSE_MULT : 1.0;
    let dist = speedKmh * dtSec / 3600; // km this tick

    while (dist > 0 && ship.pathIndex < ship.path.length - 1) {
      const target = ship.path[ship.pathIndex + 1];
      const d = haversine(ship.lat, ship.lng, target.lat, target.lng);
      if (dist >= d) {
        ship.lat = target.lat; ship.lng = target.lng;
        ship.pathIndex++;
        ship.fuel = Math.max(0, ship.fuel - d * FUEL_PER_KM * fuelMult);
        dist -= d;
      } else {
        const f = dist / d;
        const prevLat = ship.lat, prevLng = ship.lng;
        ship.lat += f * (target.lat - prevLat);
        ship.lng += f * (target.lng - prevLng);
        ship.fuel = Math.max(0, ship.fuel - dist * FUEL_PER_KM * fuelMult);
        dist = 0;
      }
    }

    // Update heading toward next waypoint
    if (ship.pathIndex < ship.path.length - 1) {
      const next = ship.path[ship.pathIndex + 1];
      ship.heading = this._bearing(ship.lat, ship.lng, next.lat, next.lng);
    }
    ship.lastUpdate = Date.now();
  }

  _bearing(lat1, lng1, lat2, lng2) {
    const dL = (lng2 - lng1) * Math.PI / 180, φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    return ((Math.atan2(Math.sin(dL) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dL)) * 180 / Math.PI) + 360) % 360;
  }

  _checkArrival(ship) {
    const d = haversine(ship.lat, ship.lng, ship.destinationLat, ship.destinationLng);
    if (d < 1.5) {
      ship.status = 'arrived'; ship.path = [];
      this._addAlert('ARRIVED', ship, `🏁 ${ship.name} arrived at ${ship.destination}`, 'info');
    }
  }

  _checkGeofence(ship) {
    for (const zone of this.zones) {
      const inside = pointInPolygon(ship.lat, ship.lng, zone.polygon);
      if (inside && !ship.inZones.has(zone.id)) {
        ship.inZones.add(zone.id);
        this._addAlert('GEOFENCE_BREACH', ship,
          `🚨 ${ship.name} entered restricted zone "${zone.name}"!`, 'critical', { zoneId: zone.id });
        this._reroute(ship);
      } else if (!inside) {
        ship.inZones.delete(zone.id);
      }
    }
  }

  _checkProximity() {
    const active = this.ships.filter(s => s.status !== 'arrived' && s.status !== 'stopped');
    const now = Date.now();
    const COOLDOWN = 30000; // 30s between repeated warnings per pair
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const d = haversine(active[i].lat, active[i].lng, active[j].lat, active[j].lng);
        if (d < PROXIMITY_KM) {
          const key = [active[i].id, active[j].id].sort().join('_');
          const lastWarned = this._proximityCooldowns.get(key) || 0;
          if (now - lastWarned > COOLDOWN) {
            this._proximityCooldowns.set(key, now);
            this.emit('proximityWarning', {
              ship1: active[i].id, ship1Name: active[i].name,
              ship2: active[j].id, ship2Name: active[j].name,
              distance: +d.toFixed(2),
            });
            this._addAlert('PROXIMITY', active[i],
              `⚠️ ${active[i].name} & ${active[j].name} are ${d.toFixed(1)} km apart!`,
              'warning', { ship2: active[j].id, distance: d });
          }
        } else {
          // Clear cooldown when ships separate
          const key = [active[i].id, active[j].id].sort().join('_');
          this._proximityCooldowns.delete(key);
        }
      }
    }
  }

  _checkFuelPrediction(ship) {
    if (!ship.path || ship.pathIndex >= ship.path.length - 1) return;
    const remaining = ship.path.slice(ship.pathIndex);
    const fuelMult = ship.weather?.isAdverse ? ADVERSE_MULT : 1.0;
    const needed = pathDistance(remaining) * FUEL_PER_KM * fuelMult;
    if (needed > ship.fuel && !ship.predictedFuelShortfall) {
      ship.predictedFuelShortfall = true;
      ship.status = 'insufficient_fuel';
      this._addAlert('FUEL_PREDICTION', ship,
        `⚠️ ${ship.name} may run out of fuel ${Math.round(needed - ship.fuel)} tons short of ${ship.destination}`,
        'warning', { needed: needed.toFixed(0), available: ship.fuel.toFixed(0) });
    } else if (needed <= ship.fuel && ship.predictedFuelShortfall) {
      ship.predictedFuelShortfall = false;
      if (ship.status === 'insufficient_fuel') ship.status = 'normal';
    }
  }

  _checkZoneApproach(ship) {
    if (!ship.path || ship.pathIndex >= ship.path.length - 1 || this.zones.length === 0) return;
    if (!ship._zoneApproachCooldowns) ship._zoneApproachCooldowns = new Map();

    // Look ahead ~3 minutes of simulated time worth of path points
    const LOOK_AHEAD_KM = (ship.speed * KNOTS_TO_KMH / 60) * 3 * SIM_SPEED;
    const ahead = ship.path.slice(ship.pathIndex, ship.pathIndex + 40);
    if (ahead.length < 2) return;

    let cumDist = 0;
    for (let i = 0; i < ahead.length - 1; i++) {
      cumDist += haversine(ahead[i].lat, ahead[i].lng, ahead[i+1].lat, ahead[i+1].lng);
      if (cumDist > LOOK_AHEAD_KM) break;

      for (const zone of this.zones) {
        if (ship.inZones && ship.inZones.has(zone.id)) continue; // already inside
        const midLat = (ahead[i].lat + ahead[i+1].lat) / 2;
        const midLng = (ahead[i].lng + ahead[i+1].lng) / 2;
        if (pointInPolygon(midLat, midLng, zone.polygon)) {
          const cooldownKey = `${ship.id}_${zone.id}`;
          const lastWarn = ship._zoneApproachCooldowns.get(cooldownKey) || 0;
          if (Date.now() - lastWarn > 60000) { // 60s cooldown
            ship._zoneApproachCooldowns.set(cooldownKey, Date.now());
            const minsAway = Math.max(1, Math.round(cumDist / ((ship.speed * KNOTS_TO_KMH / 60) * SIM_SPEED)));
            this._addAlert('ZONE_APPROACH', ship,
              `🔶 ${ship.name} will enter zone "${zone.name}" in ~${minsAway} min — rerouting now`,
              'warning', { zoneId: zone.id, minsAway });
          }
          break;
        }
      }
    }
  }

  // ── Routing ────────────────────────────────────────────────────────────────
  _reroute(ship, newDest = null) {
    if (newDest) {
      ship.destinationId = newDest.id || ship.destinationId;
      ship.destination = newDest.name;
      ship.destinationLat = newDest.lat;
      ship.destinationLng = newDest.lng;
    }
    ship.status = 'rerouting';
    const dest = { lat: ship.destinationLat, lng: ship.destinationLng };
    const path = computeRoute(ship, dest, this.zones, this.navigablePolygon, this.bbox, this._weatherCostFn);
    if (path && path.length >= 2) {
      ship.path = path; ship.pathIndex = 0;
      ship.predictedFuelShortfall = false;
      setTimeout(() => { if (ship.status === 'rerouting') ship.status = 'normal'; }, 4000);
    } else {
      // truly no path (null) - this shouldn't happen with our fallback but guard anyway
      ship.status = 'stranded'; ship.path = [];
      this._addAlert('STRANDED', ship, `🆘 ${ship.name} is stranded — no valid path!`, 'critical');
    }
  }

  getMultipleRoutes(shipId, newDest = null) {
    const ship = this.ships.find(s => s.id === shipId);
    if (!ship) return [];
    const dest = newDest ? { lat: newDest.lat, lng: newDest.lng } : { lat: ship.destinationLat, lng: ship.destinationLng };
    return computeMultipleRoutes(ship, dest, this.zones, this.navigablePolygon, this.bbox, this._weatherCostFn);
  }

  // ── Public mutations ──────────────────────────────────────────────────────
  addZone(zone) {
    this.zones.push(zone);
    for (const ship of this.ships) {
      if (ship.status === 'arrived' || ship.status === 'stopped') continue;
      if (pointInPolygon(ship.lat, ship.lng, zone.polygon)) {
        this._addAlert('GEOFENCE_BREACH', ship,
          `🚨 ${ship.name} is already inside new zone "${zone.name}"!`, 'critical', { zoneId: zone.id });
        this._reroute(ship);
      } else if (ship.path.length > 0 && pathIntersectsZone(ship.path, zone)) {
        ship.status = 'rerouting';
        this._addAlert('ZONE_PATH_CONFLICT', ship,
          `⚠️ ${ship.name} path intersects zone "${zone.name}" — auto-rerouting`, 'warning', { zoneId: zone.id });
        this._reroute(ship);
      }
    }
  }

  removeZone(zoneId) {
    this.zones = this.zones.filter(z => z.id !== zoneId);
    for (const ship of this.ships) {
      ship.inZones.delete(zoneId);
      if (ship.status === 'rerouting' || ship.status === 'stranded') this._reroute(ship);
    }
  }

  applyDirective(shipId, directive) {
    const ship = this.ships.find(s => s.id === shipId);
    if (!ship) return false;
    if (directive.type === 'REROUTE') {
      this._reroute(ship, directive.destination);
    } else if (directive.type === 'REROUTE_PATH') {
      // Captain accepted a specific route option
      if (directive.path && directive.path.length > 1) {
        if (directive.destination) {
          ship.destination = directive.destination.name;
          ship.destinationLat = directive.destination.lat;
          ship.destinationLng = directive.destination.lng;
        }
        ship.path = directive.path; ship.pathIndex = 0; ship.status = 'rerouting';
        setTimeout(() => { if (ship.status === 'rerouting') ship.status = 'normal'; }, 4000);
      }
    } else if (directive.type === 'HOLD') {
      ship.status = 'stopped'; ship.speed = 0;
    } else if (directive.type === 'RESUME') {
      ship.speed = ship.originalSpeed || 13; ship.status = 'normal';
      this._reroute(ship);
    } else if (directive.type === 'DISTRESS_ESCALATED') {
      ship.status = 'distressed'; ship.distressAnalysis = directive.analysis;
      this._addAlert('DISTRESS', ship,
        `🆘 ${ship.name}: ${directive.analysis?.summary || 'Emergency!'}`, 'critical',
        { analysis: directive.analysis });
    }
    return true;
  }

  acknowledgeAlert(alertId) {
    const a = this.alerts.find(x => x.id === alertId);
    if (a) a.acknowledged = true;
  }

  setShipDistress(shipId, analysis) {
    const ship = this.ships.find(s => s.id === shipId);
    if (ship) { ship.status = 'distressed'; ship.distressAnalysis = analysis; }
  }

  getFleetState() {
    return {
      ships: this.ships.map(s => this._serialize(s)),
      zones: this.zones,
      alerts: this.alerts.slice(-50),
    };
  }

  getShipById(id) { return this.ships.find(s => s.id === id); }

  // ── Helpers ───────────────────────────────────────────────────────────────
  _addAlert(type, ship, message, severity = 'info', extra = {}) {
    const alert = {
      id: `${type}_${ship.id}_${Date.now()}`,
      type, severity, shipId: ship.id, shipName: ship.name,
      message, timestamp: Date.now(), acknowledged: false, ...extra,
    };
    this.alerts.push(alert);
    if (this.alerts.length > 200) this.alerts.shift();
    this.emit('alert', alert);
    return alert;
  }

  _serialize(s) {
    return {
      id: s.id, name: s.name,
      lat: s.lat, lng: s.lng,
      speed: s.speed, heading: s.heading,
      destination: s.destination, destinationId: s.destinationId,
      destinationLat: s.destinationLat, destinationLng: s.destinationLng,
      fuel: Math.max(0, s.fuel), maxFuel: s.maxFuel,
      cargo: s.cargo, status: s.status,
      weather: s.weather,
      path: s.path, pathIndex: s.pathIndex,
      distressAnalysis: s.distressAnalysis,
      predictedFuelShortfall: s.predictedFuelShortfall,
      lastUpdate: s.lastUpdate,
    };
  }
}

module.exports = FleetSimulator;
