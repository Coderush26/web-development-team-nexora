import { useState } from 'react';
import { useFleetStore } from '../store/fleetStore.js';
import FleetMap from './FleetMap.jsx';
import ShipList from './ShipList.jsx';
import AlertPanel from './AlertPanel.jsx';
import ShipDetailPanel from './ShipDetailPanel.jsx';
import DirectiveModal from './DirectiveModal.jsx';
import AIAdvisor from './AIAdvisor.jsx';
import Timeline from './Timeline.jsx';

export default function CommandView() {
  const ships = useFleetStore(s => s.ships);
  const zones = useFleetStore(s => s.zones);
  const alerts = useFleetStore(s => s.alerts);
  const connected = useFleetStore(s => s.connected);
  const disconnect = useFleetStore(s => s.disconnect);
  const selectedShipId = useFleetStore(s => s.selectedShipId);

  const [leftTab, setLeftTab] = useState('ships');
  const [rightTab, setRightTab] = useState('detail');
  const [search, setSearch] = useState('');
  const [directiveShip, setDirectiveShip] = useState(null);

  const criticalAlerts = alerts.filter(a => a.severity === 'critical' && !a.acknowledged).length;
  const distressCount = ships.filter(s => s.status === 'distressed').length;

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">🚢</div>
          <div>
            <div className="brand-name">Fleet Crisis Ops</div>
            <div className="brand-sub">Command Center · Strait of Hormuz</div>
          </div>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {/* Stats */}
          <div className="stats-bar">
            <div className="stat-chip">
              <span>🚢</span>
              <span className="stat-val">{ships.length}</span>
              <span style={{ color:'var(--text-muted)' }}>ships</span>
            </div>
            <div className="stat-chip">
              <span>🚫</span>
              <span className="stat-val">{zones.length}</span>
              <span style={{ color:'var(--text-muted)' }}>zones</span>
            </div>
            {criticalAlerts > 0 && (
              <div className="stat-chip" style={{ borderColor:'rgba(248,113,113,0.3)', background:'rgba(248,113,113,0.08)' }}>
                <span>🔴</span>
                <span className="stat-val" style={{ color:'var(--accent-red)' }}>{criticalAlerts}</span>
                <span style={{ color:'var(--text-muted)' }}>alerts</span>
              </div>
            )}
            {distressCount > 0 && (
              <div className="stat-chip" style={{ borderColor:'rgba(248,113,113,0.3)', animation:'pulse-red 1s infinite' }}>
                <span>🆘</span>
                <span className="stat-val" style={{ color:'var(--accent-red)' }}>{distressCount}</span>
              </div>
            )}
          </div>

          <div className={`live-pill ${!connected ? 'disconnected' : ''}`}
            style={!connected ? { borderColor:'rgba(248,113,113,0.3)', background:'rgba(248,113,113,0.1)', color:'var(--accent-red)' } : {}}>
            <span className="live-dot" style={!connected ? { background:'var(--accent-red)' } : {}} />
            {connected ? 'LIVE' : 'OFFLINE'}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={disconnect} id="btn-disconnect">
            Exit
          </button>
        </div>
      </header>

      <div className="app-body">
        {/* Left sidebar */}
        <div className="sidebar">
          <div className="tab-bar">
            <div className={`tab ${leftTab==='ships'?'active':''}`} onClick={()=>setLeftTab('ships')}>Ships</div>
            <div className={`tab ${leftTab==='alerts'?'active':''}`} onClick={()=>setLeftTab('alerts')}>
              Alerts {criticalAlerts > 0 && <span style={{ color:'var(--accent-red)',marginLeft:4 }}>({criticalAlerts})</span>}
            </div>
          </div>

          {leftTab === 'ships' && (
            <>
              <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)' }}>
                <input
                  className="form-input" placeholder="🔍 Search ships..."
                  value={search} onChange={e => setSearch(e.target.value)}
                  style={{ width:'100%' }} id="ship-search"
                />
              </div>
              <ShipList filter={search} />
            </>
          )}

          {leftTab === 'alerts' && <AlertPanel />}
        </div>

        {/* Map */}
        <div className="map-container">
          <FleetMap canDraw={true} />
          <Timeline />
        </div>

        {/* Right sidebar */}
        <div className="sidebar-right">
          <div className="tab-bar">
            <div className={`tab ${rightTab==='detail'?'active':''}`} onClick={()=>setRightTab('detail')}>Detail</div>
            <div className={`tab ${rightTab==='ai'?'active':''}`} onClick={()=>setRightTab('ai')}>AI Advisor</div>
          </div>

          {rightTab === 'detail' && (
            <div style={{ overflow:'auto', flex:1 }}>
              <ShipDetailPanel
                shipId={selectedShipId}
                onDirective={(id) => setDirectiveShip(id)}
              />
            </div>
          )}
          {rightTab === 'ai' && <AIAdvisor />}
        </div>
      </div>

      {/* Directive modal */}
      {directiveShip && (
        <DirectiveModal shipId={directiveShip} onClose={() => setDirectiveShip(null)} />
      )}
    </div>
  );
}
