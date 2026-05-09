import { useState } from 'react';
import { useFleetStore } from '../store/fleetStore.js';

export default function ShipDetailPanel({ shipId, onDirective }) {
  const ships = useFleetStore(s => s.ships);
  const ship = ships.find(s => s.id === shipId);

  if (!ship) return (
    <div className="empty-state" style={{ marginTop: 40 }}>
      <div className="empty-icon">🚢</div>
      <div>Click a ship on the map</div>
    </div>
  );

  const fuelPct = ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel) * 100 : 50;
  const fuelColor = fuelPct > 50 ? 'var(--accent-green)' : fuelPct > 20 ? 'var(--accent-yellow)' : 'var(--accent-red)';

  return (
    <div className="detail-panel animate-fade">
      {/* Ship header */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <span style={{ fontSize:28 }}>🚢</span>
        <div>
          <div style={{ fontWeight:700, fontSize:15 }}>{ship.name}</div>
          <div style={{ fontSize:11, color:'var(--text-muted)' }}>{ship.id} · {ship.cargo}</div>
        </div>
        <span className={`badge badge-${ship.status}`} style={{ marginLeft:'auto' }}>
          {ship.status.replace(/_/g,' ')}
        </span>
      </div>

      {/* Distress analysis */}
      {ship.distressAnalysis && (
        <div className="distress-card" style={{ marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:12, fontWeight:700, color:'var(--accent-red)' }}>🆘 DISTRESS ANALYSIS</span>
            <span className={`badge sev-${ship.distressAnalysis.severity}`}>SEV {ship.distressAnalysis.severity}/5</span>
          </div>
          <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:6 }}>
            {ship.distressAnalysis.summary}
          </div>
          {ship.distressAnalysis.needs_assistance?.length > 0 && (
            <div style={{ marginTop:6, fontSize:11, color:'var(--text-muted)' }}>
              Needs: {ship.distressAnalysis.needs_assistance.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Details */}
      {[
        ['Position', `${ship.lat.toFixed(4)}°N, ${ship.lng.toFixed(4)}°E`],
        ['Speed', `${ship.speed} knots`],
        ['Heading', `${Math.round(ship.heading)}°`],
        ['Destination', ship.destination],
        ['Cargo', ship.cargo],
        ['Weather', ship.weather?.description || 'Clear'],
        ['Wind', `${ship.weather?.windSpeed?.toFixed(0) || 0} km/h`],
      ].map(([label, value]) => (
        <div className="detail-row" key={label}>
          <span className="detail-label">{label}</span>
          <span className="detail-value" style={{ fontSize:12 }}>{value}</span>
        </div>
      ))}

      {/* Fuel */}
      <div className="detail-row">
        <span className="detail-label">Fuel</span>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div className="fuel-bar" style={{ width:100 }}>
            <div className="fuel-fill" style={{ width:`${fuelPct}%`, background: fuelColor }} />
          </div>
          <span className="detail-value" style={{ fontSize:12, color:fuelColor }}>
            {ship.fuel?.toFixed(0)} / {ship.maxFuel} t
          </span>
        </div>
      </div>

      {ship.weather?.isAdverse && (
        <div style={{ marginTop:10, padding:'8px 10px', borderRadius:6, background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.25)', fontSize:12, color:'var(--accent-yellow)' }}>
          ⛈️ Adverse weather — 30% fuel penalty active
        </div>
      )}

      {ship.predictedFuelShortfall && (
        <div style={{ marginTop:8, padding:'8px 10px', borderRadius:6, background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', fontSize:12, color:'var(--accent-red)' }}>
          ⚠️ Predicted fuel shortfall before reaching destination
        </div>
      )}

      {/* Action */}
      {onDirective && (
        <button
          className="btn btn-primary"
          style={{ width:'100%', marginTop:14, justifyContent:'center' }}
          onClick={() => onDirective(ship.id)}
          id={`btn-directive-${ship.id}`}
        >
          📋 Issue Directive
        </button>
      )}
    </div>
  );
}
