import { useFleetStore } from '../store/fleetStore.js';

const STATUS_COLOR = {
  normal:'var(--status-normal)', rerouting:'var(--status-rerouting)',
  distressed:'var(--status-distressed)', stopped:'var(--status-stopped)',
  stranded:'var(--status-stranded)', arrived:'var(--status-arrived)',
  out_of_fuel:'var(--accent-red)', insufficient_fuel:'var(--accent-yellow)',
};

function FuelBar({ pct }) {
  const color = pct > 50 ? 'var(--accent-green)' : pct > 20 ? 'var(--accent-yellow)' : 'var(--accent-red)';
  return (
    <div className="fuel-bar">
      <div className="fuel-fill" style={{ width: `${Math.max(0, pct)}%`, background: color }} />
    </div>
  );
}

export default function ShipList({ filter = '' }) {
  const ships = useFleetStore(s => s.ships);
  const selectedId = useFleetStore(s => s.selectedShipId);
  const selectShip = useFleetStore(s => s.selectShip);

  const filtered = ships.filter(s =>
    !filter || s.name.toLowerCase().includes(filter.toLowerCase()) ||
    s.status.includes(filter) || s.cargo.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="ship-list">
      {filtered.map(ship => (
        <div
          key={ship.id}
          className={`ship-item ${ship.id === selectedId ? 'selected' : ''}`}
          onClick={() => selectShip(ship.id)}
          id={`ship-item-${ship.id}`}
        >
          <span className="ship-icon" style={{ color: STATUS_COLOR[ship.status] }}>🚢</span>
          <div className="ship-info">
            <div className="ship-name">{ship.name}</div>
            <div className="ship-meta">
              <span className={`badge badge-${ship.status}`}>{ship.status.replace('_',' ')}</span>
              <span style={{ marginLeft: 6 }}>{ship.destination}</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4 }}>
              <FuelBar pct={ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel) * 100 : 50} />
              <span style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'JetBrains Mono' }}>
                {ship.fuel?.toFixed(0)}t
              </span>
              <span style={{ fontSize:10, color:'var(--text-muted)' }}>·</span>
              <span style={{ fontSize:10, color:'var(--text-muted)' }}>{ship.speed}kn</span>
            </div>
          </div>
          {ship.status === 'distressed' && (
            <span style={{ fontSize:16 }} title="Distressed">🆘</span>
          )}
          {ship.weather?.isAdverse && (
            <span style={{ fontSize:14 }} title="Adverse weather">⛈️</span>
          )}
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <div>No ships found</div>
        </div>
      )}
    </div>
  );
}
