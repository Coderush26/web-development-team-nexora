import { create } from 'zustand';

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
// If deployed to Vercel, use the VITE_WS_URL env var to point to Render
const WS_URL = import.meta.env.VITE_WS_URL || 
  (import.meta.env.DEV ? `ws://${window.location.hostname}:3001` : `${protocol}//${window.location.host}`);

export const useFleetStore = create((set, get) => ({
  // Connection
  ws: null,
  connected: false,
  sessionId: null,

  // Auth
  role: null,       // 'command' | 'captain'
  myShipId: null,

  // Fleet state
  ships: [],
  zones: [],
  alerts: [],
  ports: [],

  // UI state
  selectedShipId: null,
  pendingDirectives: [],
  pendingAssistance: [],  // incoming ship-to-ship assistance requests
  distressAnalyses: [],
  aiAdvice: [],
  playbackData: null,
  playbackTs: null,
  toasts: [],
  multipleRoutes: null,   // { shipId, routes[] }

  // ── Connect ─────────────────────────────────────────────────────────────
  connect(role, shipId) {
    const existing = get().ws;
    if (existing) existing.close();

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      set({ connected: true, ws });
      ws.send(JSON.stringify({ type: 'SET_ROLE', role, shipId }));
    };

    ws.onclose = () => {
      set({ connected: false });
      // Reconnect after 2s
      setTimeout(() => {
        if (get().role) get().connect(get().role, get().myShipId);
      }, 2000);
    };

    ws.onerror = (e) => console.error('[WS]', e);

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      get()._handleMessage(msg);
    };

    set({ role, myShipId: shipId, ws });
  },

  disconnect() {
    const ws = get().ws;
    if (ws) ws.close();
    set({ ws: null, connected: false, role: null, myShipId: null });
  },

  send(msg) {
    const ws = get().ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  },

  // ── Message handler ──────────────────────────────────────────────────────
  _handleMessage(msg) {
    switch (msg.type) {
      case 'INIT':
        set({
          ships: msg.payload.ships || [],
          zones: msg.payload.zones || [],
          alerts: msg.payload.alerts || [],
          ports: msg.payload.ports || [],
          sessionId: msg.payload.sessionId,
        });
        break;

      case 'FLEET_STATE':
        if (get().playbackTs === null) {
          set({
            ships: msg.payload.ships || [],
            zones: msg.payload.zones || [],
            alerts: msg.payload.alerts || [],
          });
        }
        break;

      case 'ALERT':
        set(s => {
          const alerts = [msg.payload, ...s.alerts].slice(0, 100);
          return { alerts };
        });
        get()._showToast(msg.payload.message, msg.payload.severity);
        // Play sound for critical
        if (msg.payload.severity === 'critical') get()._playAlertSound();
        break;

      case 'PROXIMITY_WARNING':
        get()._showToast(
          `⚠️ ${msg.payload.ship1Name} & ${msg.payload.ship2Name}: ${msg.payload.distance}km apart`,
          'warning'
        );
        break;

      case 'ZONE_ADDED':
        set(s => ({ zones: [...s.zones, msg.payload] }));
        break;

      case 'ZONE_REMOVED':
        set(s => ({ zones: s.zones.filter(z => z.id !== msg.payload.zoneId) }));
        break;

      case 'DIRECTIVE_RECEIVED':
        set(s => ({
          pendingDirectives: [
            ...s.pendingDirectives.filter(d => d.id !== msg.payload.id),
            msg.payload
          ]
        }));
        get()._showToast(`📋 New directive from Command: ${msg.payload.type}`, 'info');
        get()._playAlertSound();
        break;

      case 'PENDING_DIRECTIVES':
        // Received on login — all directives that were sent before captain connected
        set(s => ({
          pendingDirectives: [
            ...s.pendingDirectives,
            ...msg.payload.filter(d => !s.pendingDirectives.find(e => e.id === d.id))
          ]
        }));
        if (msg.payload.length > 0) {
          get()._showToast(`📋 ${msg.payload.length} pending directive(s) from Command`, 'warning');
        }
        break;

      case 'DIRECTIVE_SENT':
        break;

      case 'DIRECTIVE_RESPONSE':
        set(s => ({
          pendingDirectives: s.pendingDirectives.filter(d => d.id !== msg.payload.directiveId),
        }));
        break;

      case 'DISTRESS_ANALYSIS':
        set(s => ({ distressAnalyses: [msg.payload, ...s.distressAnalyses].slice(0, 20) }));
        get()._showToast(`🆘 Distress from ${msg.payload.shipId} analyzed`, 'critical');
        break;

      case 'ALERT_ACKNOWLEDGED':
        set(s => ({
          alerts: s.alerts.map(a => a.id === msg.payload.alertId ? { ...a, acknowledged: true } : a),
        }));
        break;

      case 'AI_ADVICE':
        set({ aiAdvice: msg.payload });
        break;

      case 'MULTIPLE_ROUTES':
        set({ multipleRoutes: msg.payload });
        break;

      case 'PLAYBACK_DATA':
        set({ playbackData: msg.payload });
        break;

      case 'ASSISTANCE_REQUEST':
        set(s => ({ pendingAssistance: [...s.pendingAssistance.filter(r => r.id !== msg.payload.id), msg.payload] }));
        get()._showToast(`🤝 Assistance request from ${msg.payload.fromShipId}: ${msg.payload.assistType}`, 'warning');
        get()._playAlertSound();
        break;

      case 'PENDING_ASSISTANCE':
        set(s => ({
          pendingAssistance: [
            ...s.pendingAssistance,
            ...msg.payload.filter(r => !s.pendingAssistance.find(e => e.id === r.id))
          ]
        }));
        if (msg.payload.length > 0) {
          get()._showToast(`🤝 ${msg.payload.length} pending assistance request(s)`, 'warning');
        }
        break;

      case 'ROLE_CONFIRMED':
        break;
    }
  },

  // ── Actions ──────────────────────────────────────────────────────────────
  selectShip(id) { set({ selectedShipId: id }); },

  drawZone(polygon, name, color) {
    get().send({ type: 'DRAW_ZONE', payload: { polygon, name, color } });
  },

  removeZone(zoneId) {
    get().send({ type: 'REMOVE_ZONE', payload: { zoneId } });
  },

  sendDirective(shipId, type, destination, message, path = null) {
    get().send({ type: 'SEND_DIRECTIVE', payload: { shipId, type, destination, message, path } });
  },

  respondToDirective(directiveId, response, shipId, directive, distressMessage) {
    get().send({
      type: 'DIRECTIVE_RESPONSE',
      payload: { directiveId, response, shipId, directive, distressMessage },
    });
    set(s => ({
      pendingDirectives: s.pendingDirectives.filter(d => d.id !== directiveId),
    }));
  },

  sendDistress(shipId, message) {
    get().send({ type: 'CAPTAIN_DISTRESS', payload: { shipId, message } });
  },

  acknowledgeAlert(alertId) {
    get().send({ type: 'ACKNOWLEDGE_ALERT', payload: { alertId } });
  },

  requestAdvice() {
    get().send({ type: 'REQUEST_ADVICE' });
  },

  requestMultipleRoutes(shipId, destination = null) {
    get().send({ type: 'GET_MULTIPLE_ROUTES', payload: { shipId, destination } });
  },

  clearMultipleRoutes() { set({ multipleRoutes: null }); },

  requestPlayback() {
    get().send({ type: 'PLAYBACK_HISTORY' });
  },

  setPlaybackTs(ts) { set({ playbackTs: ts }); },

  requestAssistance(fromShipId, toShipId, assistType) {
    get().send({ type: 'SHIP_ASSISTANCE', payload: { fromShipId, toShipId, assistType } });
    const ships = get().ships;
    const toShip = ships.find(s => s.id === toShipId);
    get()._showToast(`🤝 Assistance request sent to ${toShip?.name || toShipId}`, 'info');
  },

  respondToAssistance(requestId, fromShipId, response) {
    get().send({ type: 'ASSISTANCE_RESPONSE', payload: { requestId, fromShipId, response } });
    set(s => ({ pendingAssistance: s.pendingAssistance.filter(r => r.id !== requestId) }));
    get()._showToast(response === 'ACCEPT' ? '✅ Assistance accepted' : '❌ Assistance declined', response === 'ACCEPT' ? 'success' : 'info');
  },

  // ── Toast ─────────────────────────────────────────────────────────────────
  _showToast(message, severity = 'info') {
    const id = Date.now() + Math.random();
    set(s => ({ toasts: [...s.toasts, { id, message, severity }].slice(-5) }));
    setTimeout(() => {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
    }, 4000);
  },

  dismissToast(id) {
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
  },

  // ── Sound ─────────────────────────────────────────────────────────────────
  _playAlertSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(); osc.stop(ctx.currentTime + 0.4);
    } catch { /* silent */ }
  },
}));
