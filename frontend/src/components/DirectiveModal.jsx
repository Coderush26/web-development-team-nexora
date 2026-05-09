import { useState, useEffect } from 'react';
import { useFleetStore } from '../store/fleetStore.js';

const DIRECTIVE_TYPES = [
  { value: 'REROUTE',  label: '🔀 Reroute to Port' },
  { value: 'HOLD',     label: '⏸️ Hold Position'   },
  { value: 'RESUME',   label: '▶️ Resume Course'   },
];

const RISK_COLOR = { low:'var(--accent-green)', medium:'var(--accent-yellow)', high:'var(--accent-red)', unknown:'var(--text-muted)' };
const RISK_LABEL = { low:'Low Risk', medium:'Med Risk', high:'High Risk', unknown:'Unknown' };

export default function DirectiveModal({ shipId, onClose }) {
  const [type, setType]         = useState('REROUTE');
  const [destName, setDestName] = useState('');
  const [destLat, setDestLat]   = useState('');
  const [destLng, setDestLng]   = useState('');
  const [message, setMessage]   = useState('');
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [routeLoading, setRouteLoading]   = useState(false);

  const ships               = useFleetStore(s => s.ships);
  const ports               = useFleetStore(s => s.ports);
  const multipleRoutes      = useFleetStore(s => s.multipleRoutes);
  const sendDirective       = useFleetStore(s => s.sendDirective);
  const requestMultipleRoutes = useFleetStore(s => s.requestMultipleRoutes);
  const clearMultipleRoutes   = useFleetStore(s => s.clearMultipleRoutes);
  const ship = ships.find(s => s.id === shipId);

  useEffect(() => {
    if (type === 'REROUTE') {
      setRouteLoading(true);
      const dest = (destLat && destLng) ? { lat: parseFloat(destLat), lng: parseFloat(destLng) } : null;
      requestMultipleRoutes(shipId, dest);
    }
  }, [shipId, type, destLat, destLng]);

  useEffect(() => {
    return () => clearMultipleRoutes();
  }, []);

  useEffect(() => {
    if (multipleRoutes?.shipId === shipId) {
      setRouteLoading(false);
      if (multipleRoutes.routes?.length > 0) setSelectedRoute(multipleRoutes.routes[0].id);
    }
  }, [multipleRoutes]);

  function handleSend() {
    if (type === 'REROUTE') {
      const dest = (destLat && destLng)
        ? { name: destName || 'Custom', lat: parseFloat(destLat), lng: parseFloat(destLng) }
        : null;

      if (selectedRoute && multipleRoutes?.routes) {
        const route = multipleRoutes.routes.find(r => r.id === selectedRoute);
        if (route) {
          sendDirective(shipId, 'REROUTE_PATH', dest, message, route.path);
          onClose(); return;
        }
      }
      sendDirective(shipId, 'REROUTE', dest, message);
    } else {
      sendDirective(shipId, type, null, message);
    }
    onClose();
  }

  function handlePortSelect(e) {
    const port = ports.find(p => p.name === e.target.value || p.id === e.target.value);
    if (port) {
      setDestName(port.name);
      setDestLat(String(port.lat));
      setDestLng(String(port.lng));
    }
  }

  const routes = multipleRoutes?.shipId === shipId ? multipleRoutes.routes : [];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 520 }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:'rgba(56,189,248,0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>📋</div>
          <div>
            <div className="modal-title" style={{ marginBottom:0 }}>Issue Directive</div>
            <div style={{ fontSize:12, color:'var(--text-muted)' }}>{ship?.name} · {ship?.status}</div>
          </div>
        </div>

        {/* Directive Type */}
        <div className="form-group">
          <label className="form-label">Directive Type</label>
          <div style={{ display:'flex', gap:8 }}>
            {DIRECTIVE_TYPES.map(d => (
              <div key={d.value}
                onClick={() => setType(d.value)}
                style={{
                  flex:1, padding:'8px 6px', textAlign:'center', borderRadius:8, cursor:'pointer',
                  fontSize:12, fontWeight:600,
                  border: `1px solid ${type===d.value ? 'var(--accent-blue)' : 'var(--border)'}`,
                  background: type===d.value ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.03)',
                  color: type===d.value ? 'var(--accent-blue)' : 'var(--text-secondary)',
                  transition:'all 0.15s',
                }}
              >{d.label}</div>
            ))}
          </div>
        </div>

        {type === 'REROUTE' && (
          <>
            {/* Port selector */}
            <div style={{ display:'flex', gap:10 }}>
              <div className="form-group" style={{ flex:2 }}>
                <label className="form-label">Destination Port</label>
                <select className="form-select" onChange={handlePortSelect} id="directive-port" defaultValue="">
                  <option value="">— Select port —</option>
                  {(ports||[]).map(p => <option key={p.id||p.name} value={p.id||p.name}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ flex:1 }}>
                <label className="form-label">Lat</label>
                <input className="form-input" type="number" step="0.001" value={destLat}
                  onChange={e=>setDestLat(e.target.value)} placeholder="auto" />
              </div>
              <div className="form-group" style={{ flex:1 }}>
                <label className="form-label">Lng</label>
                <input className="form-input" type="number" step="0.001" value={destLng}
                  onChange={e=>setDestLng(e.target.value)} placeholder="auto" />
              </div>
            </div>

            {/* Route options */}
            <div className="form-group">
              <label className="form-label" style={{ display:'flex', justifyContent:'space-between' }}>
                <span>Route Options</span>
                {routeLoading && <span style={{ fontSize:11, color:'var(--accent-blue)' }}>⟳ Computing...</span>}
              </label>
              {routeLoading && routes.length === 0 && (
                <div style={{ padding:'14px', textAlign:'center', color:'var(--text-muted)', fontSize:12,
                  border:'1px solid var(--border)', borderRadius:8 }}>
                  Calculating weather-aware routes...
                </div>
              )}
              {routes.map(route => (
                <div key={route.id}
                  onClick={() => setSelectedRoute(route.id)}
                  style={{
                    padding:'10px 12px', borderRadius:8, cursor:'pointer', marginBottom:6,
                    border: `1px solid ${selectedRoute===route.id ? 'var(--accent-blue)' : 'var(--border)'}`,
                    background: selectedRoute===route.id ? 'rgba(56,189,248,0.08)' : 'rgba(255,255,255,0.02)',
                    transition:'all 0.15s',
                  }}
                >
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontWeight:700, fontSize:13 }}>{route.label}</span>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <span style={{ fontSize:11, color:'var(--text-muted)' }}>{route.distanceKm} km</span>
                      <span style={{ fontSize:11, color:'var(--text-muted)' }}>~{route.fuelTons?.toFixed(0)} t</span>
                      <span style={{ fontSize:10, padding:'2px 6px', borderRadius:10,
                        background:`${RISK_COLOR[route.weatherRisk]}20`,
                        color:RISK_COLOR[route.weatherRisk] }}>
                        {RISK_LABEL[route.weatherRisk]}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{route.description}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Message */}
        <div className="form-group">
          <label className="form-label">Message to Captain <span style={{ color:'var(--text-muted)' }}>(optional)</span></label>
          <textarea className="form-textarea" value={message} onChange={e => setMessage(e.target.value)}
            placeholder="Additional instructions..." style={{ minHeight:60 }} />
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSend} id="directive-send">
            📤 Send Directive
          </button>
        </div>
      </div>
    </div>
  );
}
