import { useState } from 'react';
import { useFleetStore } from '../store/fleetStore.js';
import FleetMap from './FleetMap.jsx';
import ShipDetailPanel from './ShipDetailPanel.jsx';
import AlertPanel from './AlertPanel.jsx';

const ASSIST_TYPES = ['fuel', 'medical', 'escort', 'cargo_offload'];

export default function CaptainView() {
  const myShipId = useFleetStore(s => s.myShipId);
  const ships = useFleetStore(s => s.ships);
  const pendingDirectives = useFleetStore(s => s.pendingDirectives);
  const pendingAssistance = useFleetStore(s => s.pendingAssistance);
  const distressAnalyses = useFleetStore(s => s.distressAnalyses);
  const connected = useFleetStore(s => s.connected);
  const disconnect = useFleetStore(s => s.disconnect);
  const respondToDirective = useFleetStore(s => s.respondToDirective);
  const respondToAssistance = useFleetStore(s => s.respondToAssistance);
  const sendDistress = useFleetStore(s => s.sendDistress);
  const requestAssistance = useFleetStore(s => s.requestAssistance);

  const myShip = ships.find(s => s.id === myShipId);
  const [tab, setTab] = useState('status');
  const [distressMsg, setDistressMsg] = useState('');
  const [escalateMsg, setEscalateMsg] = useState('');
  const [escalatingId, setEscalatingId] = useState(null);
  const [assistShip, setAssistShip] = useState('');
  const [assistType, setAssistType] = useState('fuel');

  function handleSendDistress() {
    if (!distressMsg.trim()) return;
    sendDistress(myShipId, distressMsg);
    setDistressMsg('');
  }

  function handleEscalate(directive) {
    if (!escalateMsg.trim()) return;
    respondToDirective(directive.id, 'ESCALATE_DISTRESS', myShipId, directive, escalateMsg);
    setEscalatingId(null);
    setEscalateMsg('');
  }

  function handleAccept(directive) {
    respondToDirective(directive.id, 'ACCEPT', myShipId, directive);
  }

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon" style={{ background:'linear-gradient(135deg,#10b981,#06b6d4)' }}>⚓</div>
          <div>
            <div className="brand-name">{myShip?.name || myShipId}</div>
            <div className="brand-sub">Captain Interface · {myShip?.destination}</div>
          </div>
        </div>

        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          {myShip && (
            <div className="stats-bar">
              <div className="stat-chip">
                <span>⚡</span>
                <span className="stat-val">{myShip.speed}kn</span>
              </div>
              <div className="stat-chip">
                <span>⛽</span>
                <span className="stat-val" style={{ color: myShip.maxFuel > 0 && (myShip.fuel/myShip.maxFuel) < 0.2 ? 'var(--accent-red)' : 'inherit' }}>
                  {myShip.fuel?.toFixed(0)}t
                </span>
              </div>
              <span className={`badge badge-${myShip.status}`}>{myShip.status.replace(/_/g,' ')}</span>
            </div>
          )}
          <div className="live-pill">
            <span className="live-dot" style={!connected ? { background:'var(--accent-red)' } : {}} />
            {connected ? 'CONNECTED' : 'OFFLINE'}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={disconnect} id="btn-disconnect">Exit</button>
        </div>
      </header>

      <div className="app-body">
        {/* Left panel */}
        <div className="sidebar">
          <div className="tab-bar">
            <div className={`tab ${tab==='status'?'active':''}`} onClick={()=>setTab('status')}>Status</div>
            <div className={`tab ${tab==='directives'?'active':''}`} onClick={()=>setTab('directives')}>
              Directives {pendingDirectives.length>0 && <span style={{ color:'var(--accent-yellow)' }}> ({pendingDirectives.length})</span>}
            </div>
            <div className={`tab ${tab==='alerts'?'active':''}`} onClick={()=>setTab('alerts')}>Alerts</div>
          </div>

          {tab === 'status' && (
            <div style={{ overflow:'auto', flex:1 }}>
              <ShipDetailPanel shipId={myShipId} />
            </div>
          )}

          {tab === 'directives' && (
            <div style={{ overflow:'auto', flex:1, padding:12 }}>
              {/* Assistance requests section */}
              {pendingAssistance.length > 0 && (
                <>
                  <div style={{ fontSize:11, fontWeight:700, color:'var(--accent-yellow)', textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:8 }}>
                    🤝 Assistance Requests ({pendingAssistance.length})
                  </div>
                  {pendingAssistance.map(req => {
                    const fromShip = ships.find(s => s.id === req.fromShipId);
                    return (
                      <div key={req.id} className="card" style={{ marginBottom:10, borderColor:'rgba(251,191,36,0.3)', background:'rgba(251,191,36,0.06)' }}>
                        <div style={{ fontWeight:700, fontSize:13, marginBottom:4, color:'var(--accent-yellow)' }}>
                          🤝 {req.assistType.toUpperCase()} Assistance
                        </div>
                        <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:8 }}>
                          From: <strong>{fromShip?.name || req.fromShipId}</strong>
                        </div>
                        <div style={{ display:'flex', gap:8 }}>
                          <button className="btn btn-success btn-sm" style={{ flex:1, justifyContent:'center' }}
                            onClick={() => respondToAssistance(req.id, req.fromShipId, 'ACCEPT')}
                            id={`btn-assist-accept-dir-${req.id}`}>
                            ✅ Accept
                          </button>
                          <button className="btn btn-ghost btn-sm" style={{ flex:1, justifyContent:'center' }}
                            onClick={() => respondToAssistance(req.id, req.fromShipId, 'DECLINE')}
                            id={`btn-assist-decline-dir-${req.id}`}>
                            ❌ Decline
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ height:1, background:'var(--border)', margin:'8px 0 12px' }} />
                </>
              )}

              {/* Command directives section */}
              {pendingDirectives.length === 0 && pendingAssistance.length === 0 && (
                <div className="empty-state"><div className="empty-icon">📋</div>No pending directives</div>
              )}
              {pendingDirectives.length > 0 && (
                <div style={{ fontSize:11, fontWeight:700, color:'var(--accent-blue)', textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:8 }}>
                  📋 Command Directives ({pendingDirectives.length})
                </div>
              )}
              {pendingDirectives.map(d => (
                <div key={d.id} className="card" style={{ marginBottom:10 }}>
                  <div style={{ fontWeight:700, fontSize:13, marginBottom:6 }}>📋 {d.type} Directive</div>
                  {d.destination && (
                    <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:4 }}>
                      → {d.destination.name || `${d.destination.lat}, ${d.destination.lng}`}
                    </div>
                  )}
                  {d.message && (
                    <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:8, fontStyle:'italic' }}>
                      "{d.message}"
                    </div>
                  )}

                  {escalatingId === d.id ? (
                    <>
                      <textarea
                        className="form-textarea"
                        placeholder="Describe your situation (AI will analyze severity)..."
                        value={escalateMsg}
                        onChange={e => setEscalateMsg(e.target.value)}
                        id="escalate-msg"
                        style={{ marginBottom:8 }}
                      />
                      <div style={{ display:'flex', gap:8 }}>
                        <button className="btn btn-danger btn-sm" onClick={() => handleEscalate(d)} id="btn-confirm-escalate">
                          🆘 Send Distress
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEscalatingId(null)}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="btn btn-success btn-sm" onClick={() => handleAccept(d)} id={`btn-accept-${d.id}`}>
                        ✓ Accept
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => setEscalatingId(d.id)} id={`btn-escalate-${d.id}`}>
                        🆘 Escalate
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'alerts' && <AlertPanel />}
        </div>

        {/* Map focused on my ship */}
        <div className="map-container">
          <FleetMap canDraw={false} focusShipId={myShipId} isCaptainView={true} />
        </div>

        {/* Right panel — distress + assistance */}
        <div className="sidebar-right">
          <div style={{ padding:14, borderBottom:'1px solid var(--border)' }}>
            <div style={{ fontWeight:700, fontSize:13, color:'var(--accent-red)', marginBottom:10 }}>
              🆘 Distress Broadcast
            </div>
            <textarea
              className="form-textarea"
              placeholder="Describe your emergency (engine failure, medical, fire, flooding...)&#10;AI will analyze severity automatically."
              value={distressMsg}
              onChange={e => setDistressMsg(e.target.value)}
              id="distress-message"
            />
            <button
              className="btn btn-danger"
              style={{ width:'100%', marginTop:8, justifyContent:'center' }}
              onClick={handleSendDistress}
              disabled={!distressMsg.trim()}
              id="btn-send-distress"
            >
              🆘 Send Distress Call
            </button>
          </div>

          {/* Ship-to-ship assistance */}
          <div style={{ padding:14, borderBottom:'1px solid var(--border)' }}>
            <div style={{ fontWeight:700, fontSize:13, color:'var(--accent-yellow)', marginBottom:10 }}>
              🤝 Request Nearby Assistance
            </div>
            <select className="form-select" value={assistShip}
              onChange={e => setAssistShip(e.target.value)} style={{ marginBottom:8 }} id="assist-ship">
              <option value="">-- Select a ship --</option>
              {ships
                .filter(s => s.id !== myShipId && s.status !== 'arrived' && s.status !== 'out_of_fuel')
                .filter(s => {
                  if (!myShip) return false;
                  const R = 6371;
                  const dLat = (s.lat - myShip.lat) * Math.PI / 180;
                  const dLon = (s.lng - myShip.lng) * Math.PI / 180;
                  const a = Math.sin(dLat/2)**2 + Math.cos(myShip.lat * Math.PI / 180) * Math.cos(s.lat * Math.PI / 180) * Math.sin(dLon/2)**2;
                  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                  s._dist = dist;
                  return dist <= 150; // 150km radar range
                })
                .sort((a, b) => a._dist - b._dist)
                .map(s => (
                  <option key={s.id} value={s.id}>{s.name} [{s.status}] ({Math.round(s._dist)}km)</option>
                ))}
            </select>
            <select className="form-select" value={assistType}
              onChange={e => setAssistType(e.target.value)} style={{ marginBottom:8 }} id="assist-type">
              {ASSIST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button
              className="btn btn-warning btn-sm"
              style={{ width:'100%', justifyContent:'center' }}
              onClick={() => { if (assistShip) { requestAssistance(myShipId, assistShip, assistType); setAssistShip(''); } }}
              disabled={!assistShip}
              id="btn-request-assistance"
            >
              Request {assistType}
            </button>
          </div>

          {/* Incoming Assistance Requests */}
          {pendingAssistance.length > 0 && (
            <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontWeight:700, fontSize:12, color:'var(--accent-yellow)', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.5px' }}>
                🤝 Incoming Assistance ({pendingAssistance.length})
              </div>
              {pendingAssistance.map(req => {
                const fromShip = ships.find(s => s.id === req.fromShipId);
                return (
                  <div key={req.id} style={{ padding:'10px 12px', borderRadius:8, marginBottom:6,
                    background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.25)' }}>
                    <div style={{ fontSize:12, fontWeight:700, marginBottom:4 }}>
                      {fromShip?.name || req.fromShipId} requests <span style={{ color:'var(--accent-yellow)' }}>{req.assistType}</span>
                    </div>
                    <div style={{ display:'flex', gap:6 }}>
                      <button className="btn btn-success btn-sm" style={{ flex:1, justifyContent:'center' }}
                        onClick={() => respondToAssistance(req.id, req.fromShipId, 'ACCEPT')}
                        id={`btn-assist-accept-${req.id}`}>
                        ✅ Accept
                      </button>
                      <button className="btn btn-ghost btn-sm" style={{ flex:1, justifyContent:'center' }}
                        onClick={() => respondToAssistance(req.id, req.fromShipId, 'DECLINE')}
                        id={`btn-assist-decline-${req.id}`}>
                        ❌ Decline
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Distress analyses */}
          <div style={{ flex:1, overflow:'auto', padding:12 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', marginBottom:8 }}>
              AI Analysis History
            </div>
            {distressAnalyses.length === 0 && (
              <div className="empty-state"><div>No analyses yet</div></div>
            )}
            {distressAnalyses.map((a, i) => (
              <div key={i} className="distress-card" style={{ marginBottom:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ fontSize:11, color:'var(--text-muted)' }}>{a.shipId}</span>
                  <span className={`badge sev-${a.analysis?.severity}`}>SEV {a.analysis?.severity}/5</span>
                </div>
                <div style={{ fontSize:12, marginTop:4, color:'var(--text-secondary)' }}>
                  {a.analysis?.summary}
                </div>
                <div style={{ fontSize:11, marginTop:4, color:'var(--text-muted)' }}>
                  → {a.analysis?.immediate_action}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
