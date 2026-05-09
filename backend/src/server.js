'use strict';
require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const FleetSimulator = require('./simulator');
const PlaybackRecorder = require('./playback');
const { analyzeDistress, getFleetAdvice } = require('./ai');
const fleetData = require('./data/fleet.json');

const PORT = process.env.PORT || 3001;

const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => res.send('Fleet Crisis Ops Backend is running! Connect via WebSocket.'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const simulator = new FleetSimulator();
const recorder = new PlaybackRecorder();

// clients: Map<ws, { role, shipId, sessionId }>
const clients = new Map();
const pendingDirectives = new Map();
const pendingAssistanceRequests = new Map();

// ── Broadcast helpers ─────────────────────────────────────────────────────────
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function broadcastToRole(role, msg) {
  const data = JSON.stringify(msg);
  for (const [ws, meta] of clients) {
    if (ws.readyState === WebSocket.OPEN && meta.role === role) ws.send(data);
  }
}

function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ── Simulator events ──────────────────────────────────────────────────────────
simulator.on('update', (state) => {
  recorder.record(state.ships, state.zones);
  broadcast({ type: 'FLEET_STATE', payload: state, ts: Date.now() });
});

simulator.on('alert', (alert) => {
  recorder.addEvent('ALERT', alert);
  broadcast({ type: 'ALERT', payload: alert, ts: Date.now() });
});

simulator.on('proximityWarning', (w) => {
  broadcast({ type: 'PROXIMITY_WARNING', payload: w, ts: Date.now() });
});

// ── WebSocket ────────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const sessionId = uuidv4();
  clients.set(ws, { role: 'observer', shipId: null, sessionId });
  console.log(`[WS] Client connected (${sessionId}). Total: ${clients.size}`);

  // Send initial state immediately
  sendTo(ws, { type: 'INIT', payload: {
    ...simulator.getFleetState(),
    ports: simulator.ports,
    sessionId,
  }, ts: Date.now() });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const meta = clients.get(ws);

    switch (msg.type) {
      case 'SET_ROLE': {
        meta.role = msg.role; // 'command' | 'captain'
        meta.shipId = msg.shipId || null;
        sendTo(ws, { type: 'ROLE_CONFIRMED', payload: { role: meta.role, shipId: meta.shipId } });
        // If captain, immediately flush any pending directives and assistance requests
        if (meta.role === 'captain' && meta.shipId) {
          const pending = pendingDirectives.get(meta.shipId) || [];
          if (pending.length > 0) {
            sendTo(ws, { type: 'PENDING_DIRECTIVES', payload: pending, ts: Date.now() });
          }
          const pendingAssist = pendingAssistanceRequests.get(meta.shipId) || [];
          if (pendingAssist.length > 0) {
            sendTo(ws, { type: 'PENDING_ASSISTANCE', payload: pendingAssist, ts: Date.now() });
          }
        }
        break;
      }

      case 'DRAW_ZONE': {
        if (meta.role !== 'command') return;
        const zone = {
          id: uuidv4(),
          name: msg.payload.name || 'Restricted Zone',
          polygon: msg.payload.polygon,
          createdAt: Date.now(),
          createdBy: sessionId,
          color: msg.payload.color || '#ff4444',
        };
        simulator.addZone(zone);
        broadcast({ type: 'ZONE_ADDED', payload: zone, ts: Date.now() });
        recorder.addEvent('ZONE_ADDED', zone);
        break;
      }

      case 'REMOVE_ZONE': {
        if (meta.role !== 'command') return;
        simulator.removeZone(msg.payload.zoneId);
        broadcast({ type: 'ZONE_REMOVED', payload: { zoneId: msg.payload.zoneId }, ts: Date.now() });
        break;
      }

      case 'SEND_DIRECTIVE': {
        if (meta.role !== 'command') return;
        const directive = {
          id: uuidv4(),
          shipId: msg.payload.shipId,
          type: msg.payload.type,
          destination: msg.payload.destination,
          message: msg.payload.message,
          path: msg.payload.path || null,
          timestamp: Date.now(),
          status: 'pending',
        };
        // Persist directive so captain gets it even if they connect later
        const existing = pendingDirectives.get(directive.shipId) || [];
        pendingDirectives.set(directive.shipId, [...existing, directive]);
        // Forward to captain if currently connected
        let captainOnline = false;
        for (const [cws, cmeta] of clients) {
          if (cmeta.role === 'captain' && cmeta.shipId === directive.shipId) {
            sendTo(cws, { type: 'DIRECTIVE_RECEIVED', payload: directive, ts: Date.now() });
            captainOnline = true;
          }
        }
        console.log(`[DIRECTIVE] Sent to ${directive.shipId} (captain online: ${captainOnline})`);
        broadcast({ type: 'DIRECTIVE_SENT', payload: directive, ts: Date.now() });
        recorder.addEvent('DIRECTIVE_SENT', directive);
        break;
      }

      case 'DIRECTIVE_RESPONSE': {
        if (meta.role !== 'captain') return;
        const { directiveId, response, shipId, distressMessage } = msg.payload;
        if (response === 'ACCEPT') {
          simulator.applyDirective(shipId, msg.payload.directive);
          // Remove from pending directives store
          const remaining = (pendingDirectives.get(shipId) || []).filter(d => d.id !== directiveId);
          if (remaining.length === 0) pendingDirectives.delete(shipId);
          else pendingDirectives.set(shipId, remaining);
        } else if (response === 'ESCALATE_DISTRESS') {
          // Analyze distress with AI
          const analysis = await analyzeDistress(distressMessage || 'Captain escalated distress', shipId);
          simulator.applyDirective(shipId, { type: 'DISTRESS_ESCALATED', analysis });
          broadcast({ type: 'DISTRESS_ANALYSIS', payload: { shipId, analysis, message: distressMessage }, ts: Date.now() });
          // Remove from pending directives store
          const remaining = (pendingDirectives.get(shipId) || []).filter(d => d.id !== directiveId);
          if (remaining.length === 0) pendingDirectives.delete(shipId);
          else pendingDirectives.set(shipId, remaining);
        }
        broadcast({ type: 'DIRECTIVE_RESPONSE', payload: { directiveId, response, shipId }, ts: Date.now() });
        recorder.addEvent('DIRECTIVE_RESPONSE', msg.payload);
        break;
      }

      case 'CAPTAIN_DISTRESS': {
        // Captain sends a free-form distress message
        const { shipId, message } = msg.payload;
        const analysis = await analyzeDistress(message, shipId);
        simulator.setShipDistress(shipId, analysis);
        
        const ship = simulator.getShipById(shipId);
        if (ship) {
          simulator._addAlert('DISTRESS', ship,
            `🆘 ${ship.name}: ${analysis?.summary || 'Emergency!'}`, 'critical',
            { analysis });
        }
        
        broadcast({ type: 'DISTRESS_ANALYSIS', payload: { shipId, analysis, message }, ts: Date.now() });
        recorder.addEvent('DISTRESS', { shipId, message, analysis });
        break;
      }

      case 'ACKNOWLEDGE_ALERT': {
        simulator.acknowledgeAlert(msg.payload.alertId);
        broadcast({ type: 'ALERT_ACKNOWLEDGED', payload: { alertId: msg.payload.alertId }, ts: Date.now() });
        break;
      }

      case 'REQUEST_ADVICE': {
        if (meta.role !== 'command') return;
        const state = simulator.getFleetState();
        const advice = await getFleetAdvice(state.ships, state.alerts, state.zones);
        sendTo(ws, { type: 'AI_ADVICE', payload: advice, ts: Date.now() });
        break;
      }

      case 'PLAYBACK_HISTORY': {
        sendTo(ws, { type: 'PLAYBACK_DATA', payload: recorder.getHistory(), ts: Date.now() });
        break;
      }

      case 'SHIP_ASSISTANCE': {
        // Ship-to-ship assistance request
        const { fromShipId, toShipId, assistType } = msg.payload;
        const req = { id: uuidv4(), fromShipId, toShipId, assistType, timestamp: Date.now() };
        // Persist so receiving captain gets it even if they connect later
        const existingAssist = pendingAssistanceRequests.get(toShipId) || [];
        pendingAssistanceRequests.set(toShipId, [...existingAssist, req]);
        // Forward to captain if currently connected
        let captainOnline = false;
        for (const [cws, cmeta] of clients) {
          if (cmeta.role === 'captain' && cmeta.shipId === toShipId) {
            sendTo(cws, { type: 'ASSISTANCE_REQUEST', payload: req, ts: Date.now() });
            captainOnline = true;
          }
        }
        console.log(`[ASSIST] ${fromShipId} -> ${toShipId} (${assistType}), captain online: ${captainOnline}`);
        broadcast({ type: 'ASSISTANCE_SENT', payload: req, ts: Date.now() });
        recorder.addEvent('ASSISTANCE_SENT', req);
        break;
      }

      case 'ASSISTANCE_RESPONSE': {
        const { requestId, fromShipId, response } = msg.payload;
        // Notify the requesting captain of the response
        for (const [cws, cmeta] of clients) {
          if (cmeta.role === 'captain' && cmeta.shipId === fromShipId) {
            sendTo(cws, { type: 'ASSISTANCE_RESOLVED', payload: { requestId, response }, ts: Date.now() });
          }
        }
        // Notify all command clients too
        broadcast({ type: 'ASSISTANCE_RESOLVED', payload: { requestId, fromShipId, response, respondingShipId: meta.shipId }, ts: Date.now() });
        recorder.addEvent('ASSISTANCE_RESPONSE', msg.payload);
        break;
      }

      case 'GET_MULTIPLE_ROUTES': {
        const routes = simulator.getMultipleRoutes(msg.payload.shipId, msg.payload.destination || null);
        sendTo(ws, { type: 'MULTIPLE_ROUTES', payload: { shipId: msg.payload.shipId, routes }, ts: Date.now() });
        break;
      }

      case 'PING':
        sendTo(ws, { type: 'PONG', ts: Date.now() });
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected. Total: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
    clients.delete(ws);
  });
});

// ── REST endpoints ────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', clients: clients.size, tick: simulator.tickCount }));
app.get('/fleet', (_, res) => res.json(simulator.getFleetState()));
app.get('/fleet/ship/:id', (req, res) => {
  const ship = simulator.getShipById(req.params.id);
  if (!ship) return res.status(404).json({ error: 'Ship not found' });
  res.json(ship);
});
app.get('/playback', (_, res) => res.json(recorder.getHistory()));
app.get('/ports', (_, res) => res.json(simulator.ports));

// ── Boot ──────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🚢 Fleet Crisis Ops Backend running on port ${PORT}`);
  simulator.start();
});

module.exports = { app, server };
