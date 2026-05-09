'use strict';

// ── Ring buffer: 120 snapshots × 30s = 1 hour ───────────────────────────────
const MAX_SNAPSHOTS = 120;
const SNAPSHOT_INTERVAL = 30000; // ms

class PlaybackRecorder {
  constructor() {
    this.snapshots = [];   // [{ timestamp, ships, zones }]
    this.events = [];      // [{ timestamp, type, payload }]
    this.lastSnapshotAt = 0;
  }

  record(ships, zones, now = Date.now()) {
    if (now - this.lastSnapshotAt >= SNAPSHOT_INTERVAL) {
      const snap = {
        timestamp: now,
        ships: JSON.parse(JSON.stringify(ships)),
        zones: JSON.parse(JSON.stringify(zones)),
      };
      this.snapshots.push(snap);
      if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
      this.lastSnapshotAt = now;
    }
  }

  addEvent(type, payload, now = Date.now()) {
    this.events.push({ timestamp: now, type, payload });
    // Keep last 500 events
    if (this.events.length > 500) this.events.shift();
  }

  getHistory() {
    return {
      snapshots: this.snapshots.map(s => ({
        timestamp: s.timestamp,
        shipCount: s.ships.length,
        ships: s.ships.map(sh => ({
          id: sh.id, name: sh.name, lat: sh.lat, lng: sh.lng,
          status: sh.status, fuel: sh.fuel,
        })),
        zones: s.zones,
      })),
      events: this.events,
    };
  }

  getSnapshotAt(timestamp) {
    // Find closest snapshot ≤ timestamp
    let best = null;
    for (const snap of this.snapshots) {
      if (snap.timestamp <= timestamp) best = snap;
    }
    return best;
  }
}

module.exports = PlaybackRecorder;
