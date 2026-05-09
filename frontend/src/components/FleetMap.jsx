import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Polygon, Popup, Tooltip, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw';
import { useFleetStore } from '../store/fleetStore.js';

const STATUS_COLOR = {
  normal:'#34d399', rerouting:'#fbbf24', distressed:'#f87171',
  stopped:'#94a3b8', stranded:'#ef4444', arrived:'#38bdf8',
  out_of_fuel:'#ef4444', insufficient_fuel:'#fbbf24',
};
const STATUS_GLOW = {
  normal:'34,211,153', rerouting:'251,191,36', distressed:'248,113,113',
  stopped:'148,163,184', stranded:'239,68,68', arrived:'56,189,248',
  out_of_fuel:'239,68,68', insufficient_fuel:'251,191,36',
};

function makeShipIcon(ship, isSelected) {
  const color = STATUS_COLOR[ship.status] || '#94a3b8';
  const glow = STATUS_GLOW[ship.status] || '148,163,184';
  const sz = isSelected ? 48 : 36;
  const isAlert = ship.status === 'distressed' || ship.status === 'stranded';

  const pulse = isAlert ? `
    <circle cx="12" cy="12" r="18" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.5">
      <animate attributeName="r" values="16;28;16" dur="1.8s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.6;0;0.6" dur="1.8s" repeatCount="indefinite"/>
    </circle>
    <circle cx="12" cy="12" r="12" fill="none" stroke="${color}" stroke-width="1" opacity="0.3">
      <animate attributeName="r" values="12;20;12" dur="1.8s" begin="0.4s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.4;0;0.4" dur="1.8s" begin="0.4s" repeatCount="indefinite"/>
    </circle>` : '';

  const ring = isSelected ? `<circle cx="12" cy="12" r="18" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.6" stroke-dasharray="4,3">
    <animateTransform attributeName="transform" type="rotate" values="0 12 12;360 12 12" dur="8s" repeatCount="indefinite"/>
  </circle>` : '';

  // Shadow glow behind ship
  const glow_filter = `<filter id="glow"><feGaussianBlur stdDeviation="3" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

  const svg = `<svg width="${sz}" height="${sz}" viewBox="-8 -8 40 40" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
    <defs>${glow_filter}</defs>
    ${pulse}${ring}
    <!-- Shadow -->
    <ellipse cx="12" cy="22" rx="7" ry="3" fill="rgba(0,0,0,0.5)" filter="url(#glow)"/>
    <!-- Ship body -->
    <path d="M12 1 L21 21 L12 16 L3 21 Z" fill="${color}" stroke="rgba(255,255,255,0.9)" stroke-width="1.2"
      style="filter:drop-shadow(0 0 ${isSelected?8:4}px rgba(${glow},0.9))"/>
    <!-- Ship cockpit -->
    <ellipse cx="12" cy="11" rx="2.5" ry="3" fill="rgba(255,255,255,0.4)" stroke="rgba(255,255,255,0.6)" stroke-width="0.5"/>
  </svg>`;

  return L.divIcon({
    html: `<div style="transform:rotate(${ship.heading||0}deg);transform-origin:center center;">${svg}</div>`,
    className: '', iconSize: [sz, sz], iconAnchor: [sz/2, sz/2]
  });
}

function makePortIcon() {
  const svg = `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="portglow"><feGaussianBlur stdDeviation="2" result="coloredBlur"/>
        <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <circle cx="11" cy="11" r="9" fill="rgba(14,165,233,0.15)" stroke="rgba(14,165,233,0.6)" stroke-width="1.5"/>
    <circle cx="11" cy="11" r="5" fill="rgba(14,165,233,0.3)" stroke="#38bdf8" stroke-width="1"/>
    <circle cx="11" cy="11" r="2.5" fill="#38bdf8" filter="url(#portglow)"/>
    <line x1="11" y1="4" x2="11" y2="18" stroke="rgba(56,189,248,0.4)" stroke-width="1" stroke-dasharray="2,2"/>
    <line x1="4" y1="11" x2="18" y2="11" stroke="rgba(56,189,248,0.4)" stroke-width="1" stroke-dasharray="2,2"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [22, 22], iconAnchor: [11, 11] });
}

function useInterpolatedShips(ships) {
  const prevRef = useRef({});
  const frameRef = useRef(null);
  const [display, setDisplay] = useState(ships);

  useEffect(() => {
    if (!ships.length) return;
    const start = performance.now();
    const prev = {};
    ships.forEach(s => { prev[s.id] = prevRef.current[s.id] || { lat: s.lat, lng: s.lng }; });
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    const DURATION = 950;
    function animate(t) {
      const frac = Math.min((t - start) / DURATION, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - frac, 3);
      setDisplay(ships.map(s => {
        const p = prev[s.id] || s;
        return { ...s, lat: p.lat + (s.lat - p.lat) * ease, lng: p.lng + (s.lng - p.lng) * ease };
      }));
      if (frac < 1) frameRef.current = requestAnimationFrame(animate);
    }
    frameRef.current = requestAnimationFrame(animate);
    prevRef.current = {};
    ships.forEach(s => { prevRef.current[s.id] = { lat: s.lat, lng: s.lng }; });
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [ships]);
  return display;
}

function DrawControl({ onZoneDrawn }) {
  const map = useMap();
  const [drawing, setDrawing] = useState(false);
  const handlerRef = useRef(null);
  const drawnRef = useRef(null);

  useEffect(() => {
    const drawn = new L.FeatureGroup();
    map.addLayer(drawn);
    drawnRef.current = drawn;
    map.on(L.Draw.Event.CREATED, (e) => {
      drawn.addLayer(e.layer);
      const pts = e.layer.getLatLngs()[0].map(p => [p.lat, p.lng]);
      const name = prompt('Zone name:', 'Restricted Zone') || 'Restricted Zone';
      onZoneDrawn(pts, name);
      setDrawing(false);
    });
    map.on('draw:drawstop', () => { setDrawing(false); });
    return () => { map.removeLayer(drawn); map.off(L.Draw.Event.CREATED); map.off('draw:drawstop'); };
  }, [map, onZoneDrawn]);

  const startDraw = useCallback(() => {
    if (handlerRef.current) handlerRef.current.disable();
    const handler = new L.Draw.Polygon(map, {
      allowIntersection: false,
      shapeOptions: { color: '#f87171', fillColor: '#f87171', fillOpacity: 0.15, weight: 2, dashArray: '6,4' },
    });
    handler.enable();
    handlerRef.current = handler;
    setDrawing(true);
  }, [map]);

  const cancelDraw = useCallback(() => {
    if (handlerRef.current) { handlerRef.current.disable(); handlerRef.current = null; }
    setDrawing(false);
  }, []);

  return (
    <div style={{ position:'absolute', top:20, right:20, zIndex:1000, display:'flex', flexDirection:'column', gap:8 }}>
      <button
        id="btn-draw-zone"
        onClick={drawing ? cancelDraw : startDraw}
        style={{
          padding:'10px 16px', borderRadius:10, cursor:'pointer',
          border: drawing ? '1px solid rgba(248,113,113,0.6)' : '1px solid rgba(56,189,248,0.4)',
          background: drawing ? 'rgba(30,10,10,0.85)' : 'rgba(10,20,35,0.85)',
          color: drawing ? '#fca5a5' : '#7dd3fc',
          fontSize:13, fontWeight:700, fontFamily:'Outfit,sans-serif',
          backdropFilter:'blur(16px)', boxShadow: drawing ? '0 0 20px rgba(248,113,113,0.3)' : '0 0 20px rgba(14,165,233,0.2)',
          display:'flex', alignItems:'center', gap:8, transition:'all 0.3s',
          letterSpacing:'0.5px',
        }}
      >
        {drawing ? '✕ Cancel Drawing' : '🚫 Draw Restricted Zone'}
      </button>
      {drawing && (
        <div style={{
          padding:'8px 12px', borderRadius:8,
          background:'rgba(30,10,10,0.8)', border:'1px solid rgba(248,113,113,0.3)',
          color:'#fca5a5', fontSize:11, textAlign:'center', backdropFilter:'blur(12px)',
        }}>
          Click map to place points. Click first point to close.
        </div>
      )}
    </div>
  );
}

function AutoPan({ ships, selectedId, focusId }) {
  const map = useMap();
  useEffect(() => {
    const id = selectedId || focusId;
    if (!id) return;
    const s = ships.find(x => x.id === id);
    if (s) map.panTo([s.lat, s.lng], { animate: true, duration: 0.8 });
  }, [selectedId]);
  return null;
}

// Animated route with gradient effect
function AnimatedRoute({ ship }) {
  if (!ship.path || ship.pathIndex >= ship.path.length - 1) return null;
  const rem = ship.path.slice(Math.max(0, ship.pathIndex));
  if (rem.length < 2) return null;
  const color = STATUS_COLOR[ship.status] || '#38bdf8';
  const positions = rem.map(p => [p.lat, p.lng]);

  return (
    <>
      {/* Wide glow trail */}
      <Polyline positions={positions} pathOptions={{ color, opacity: 0.08, weight: 12 }} />
      {/* Medium glow */}
      <Polyline positions={positions} pathOptions={{ color, opacity: 0.15, weight: 6 }} />
      {/* Core dashed line */}
      <Polyline positions={positions} pathOptions={{ color, opacity: 0.6, weight: 2, dashArray: '8,6' }} />
    </>
  );
}

export default function FleetMap({ canDraw = false, focusShipId = null }) {
  const ships      = useFleetStore(s => s.ships);
  const zones      = useFleetStore(s => s.zones);
  const ports      = useFleetStore(s => s.ports);
  const selectedId = useFleetStore(s => s.selectedShipId);
  const selectShip = useFleetStore(s => s.selectShip);
  const drawZone   = useFleetStore(s => s.drawZone);
  const removeZone = useFleetStore(s => s.removeZone);
  const display    = useInterpolatedShips(ships);
  const [mapStyle, setMapStyle] = useState('nautical');

  const center = focusShipId
    ? (() => { const s = ships.find(x => x.id === focusShipId); return s ? [s.lat, s.lng] : [26.0, 56.0]; })()
    : [26.0, 54.0];

  const portIcon = makePortIcon();

  const tileOptions = {
    nautical: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri &mdash; Sources: GEBCO, NOAA',
      label: '🌊 Nautical',
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
      label: '🛰️ Satellite',
    },
    dark: {
      url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
      attribution: '&copy; Stadia Maps',
      label: '🌑 Dark',
    },
  };

  const tile = tileOptions[mapStyle];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer
        center={center}
        zoom={focusShipId ? 9 : 6}
        style={{ width: '100%', height: '100%' }}
        zoomControl
      >
        <TileLayer url={tile.url} attribution={tile.attribution} maxZoom={18} />

        {/* Ocean reference layer for nautical mode */}
        {mapStyle === 'nautical' && (
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}"
            attribution=""
            maxZoom={13}
            opacity={0.8}
          />
        )}

        {canDraw && <DrawControl onZoneDrawn={(poly, name) => drawZone(poly, name, '#f87171')} />}
        <AutoPan ships={display} selectedId={selectedId} focusId={focusShipId} />

        {/* Ports */}
        {(ports || []).map(port => (
          <Marker key={port.id || port.name} position={[port.lat, port.lng]} icon={portIcon}>
            <Tooltip direction="right" offset={[14, 0]} permanent className="port-label-tooltip">
              ⚓ {port.name}
            </Tooltip>
            <Popup>
              <div style={{ fontFamily:'Outfit,sans-serif', background:'rgba(10,20,40,0.98)', color:'#f8fafc', padding:'12px 14px', borderRadius:10, fontSize:13, border:'1px solid rgba(56,189,248,0.3)', minWidth:160 }}>
                <div style={{ fontWeight:800, fontSize:15, color:'#38bdf8', marginBottom:4 }}>⚓ {port.name}</div>
                <div style={{ color:'#94a3b8', fontSize:12 }}>Maritime Port</div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Restricted zones */}
        {zones.map(zone => (
          <Polygon key={zone.id} positions={zone.polygon}
            pathOptions={{ color:'#f87171', fillColor:'#ef4444', fillOpacity:0.08, weight:2, dashArray:'8,5' }}>
            <Popup>
              <div style={{ fontFamily:'Outfit,sans-serif', background:'rgba(30,10,10,0.98)', color:'#fca5a5', padding:'12px 14px', borderRadius:10, border:'1px solid rgba(239,68,68,0.4)', minWidth:180 }}>
                <strong style={{ fontSize:14 }}>🚫 {zone.name}</strong>
                <div style={{ color:'#94a3b8', fontSize:12, marginTop:4 }}>Restricted Navigation Zone</div>
                {canDraw && (
                  <button className="btn btn-danger btn-sm" style={{ width:'100%', marginTop:10 }}
                    onClick={() => removeZone(zone.id)}>Remove Zone</button>
                )}
              </div>
            </Popup>
          </Polygon>
        ))}

        {/* Ship paths with glow effect */}
        {display.map(ship => <AnimatedRoute key={`r-${ship.id}`} ship={ship} />)}

        {/* Ships */}
        {display.map(ship => (
          <Marker key={ship.id} position={[ship.lat, ship.lng]}
            icon={makeShipIcon(ship, ship.id === selectedId || ship.id === focusShipId)}
            eventHandlers={{ click: () => selectShip(ship.id) }}
            zIndexOffset={ship.id === selectedId ? 1000 : 0}>
            <Tooltip direction="bottom" offset={[0, 16]} permanent className="ship-name-tooltip">
              {ship.name}
            </Tooltip>
            <Popup minWidth={260}>
              <div style={{ fontFamily:'Outfit,sans-serif', background:'rgba(5,15,30,0.98)', color:'#f8fafc', padding:'14px 16px', borderRadius:12, border:`1px solid rgba(${STATUS_GLOW[ship.status]||'56,189,248'},0.4)` }}>
                <div style={{ fontWeight:800, fontSize:15, marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
                  🚢 {ship.name}
                  <span style={{ fontSize:11, padding:'2px 8px', borderRadius:20, background:`rgba(${STATUS_GLOW[ship.status]},0.15)`, color:STATUS_COLOR[ship.status], fontWeight:700, letterSpacing:'0.5px', textTransform:'uppercase' }}>
                    {ship.status.replace(/_/g,' ')}
                  </span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'6px 12px', fontSize:12, color:'#94a3b8' }}>
                  <span>Speed</span><span style={{ fontWeight:700, color:'#fff', fontFamily:'JetBrains Mono,monospace' }}>{ship.speed} kn · {Math.round(ship.heading)}°</span>
                  <span>Cargo</span><span style={{ fontWeight:600, color:'#e2e8f0' }}>{ship.cargo}</span>
                  <span>Dest.</span><span style={{ fontWeight:700, color:'#38bdf8' }}>{ship.destination}</span>
                  <span>Weather</span><span style={{ color: ship.weather?.isAdverse ? '#fbbf24' : '#34d399', fontWeight:600 }}>{ship.weather?.description || 'Clear'}</span>
                </div>
                {/* Fuel bar */}
                <div style={{ marginTop:10 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#64748b', marginBottom:4 }}>
                    <span>FUEL</span>
                    <span style={{ fontFamily:'JetBrains Mono,monospace', color:'#94a3b8', fontWeight:700 }}>
                      {ship.fuel?.toFixed(0)} / {ship.maxFuel}t {ship.predictedFuelShortfall ? '⚠️' : ''}
                    </span>
                  </div>
                  <div style={{ height:6, background:'rgba(0,0,0,0.5)', borderRadius:6, overflow:'hidden' }}>
                    <div style={{
                      height:'100%', borderRadius:6, transition:'width 0.5s',
                      width:`${ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel) * 100 : 50}%`,
                      background: ship.fuel/ship.maxFuel > 0.5 ? 'linear-gradient(90deg,#059669,#34d399)' : ship.fuel/ship.maxFuel > 0.2 ? 'linear-gradient(90deg,#b45309,#fbbf24)' : 'linear-gradient(90deg,#991b1b,#f87171)',
                      boxShadow: `0 0 8px ${ship.fuel/ship.maxFuel > 0.5 ? '#34d399' : ship.fuel/ship.maxFuel > 0.2 ? '#fbbf24' : '#f87171'}`,
                    }} />
                  </div>
                </div>
                {ship.weather?.isAdverse && <div style={{ marginTop:8, fontSize:11, color:'#fbbf24', padding:'4px 8px', background:'rgba(245,158,11,0.1)', borderRadius:6, border:'1px solid rgba(245,158,11,0.2)' }}>⛈️ Adverse weather — +30% fuel burn</div>}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Distress aura rings */}
        {display.filter(s => s.status === 'distressed' || s.status === 'stranded').map(s => (
          <>
            <Circle key={`dr1-${s.id}`} center={[s.lat, s.lng]} radius={12000}
              pathOptions={{ color:'#ef4444', fillOpacity:0.03, weight:1.5, dashArray:'6,6' }} />
            <Circle key={`dr2-${s.id}`} center={[s.lat, s.lng]} radius={6000}
              pathOptions={{ color:'#f87171', fillOpacity:0.06, weight:1 }} />
          </>
        ))}

        {/* Selected ship targeting ring */}
        {selectedId && (() => {
          const s = display.find(x => x.id === selectedId);
          if (!s) return null;
          const color = STATUS_COLOR[s.status] || '#38bdf8';
          return (
            <>
              <Circle key="sel-outer" center={[s.lat, s.lng]} radius={5000}
                pathOptions={{ color, fillOpacity:0.04, weight:1.5, dashArray:'4,6' }} />
              <Circle key="sel-inner" center={[s.lat, s.lng]} radius={2000}
                pathOptions={{ color, fillOpacity:0.08, weight:1 }} />
            </>
          );
        })()}
      </MapContainer>

      {/* Map style switcher */}
      <div style={{
        position:'absolute', bottom:24, right:24, zIndex:900,
        display:'flex', gap:8, background:'rgba(5,15,30,0.85)',
        backdropFilter:'blur(16px)', borderRadius:12, padding:'8px 10px',
        border:'1px solid rgba(56,189,248,0.2)', boxShadow:'0 8px 30px rgba(0,0,0,0.6)',
      }}>
        {Object.entries(tileOptions).map(([key, opt]) => (
          <button key={key}
            onClick={() => setMapStyle(key)}
            style={{
              padding:'6px 12px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700,
              fontFamily:'Outfit,sans-serif', border:'none', outline:'none', transition:'all 0.3s',
              background: mapStyle === key ? 'rgba(14,165,233,0.3)' : 'transparent',
              color: mapStyle === key ? '#7dd3fc' : '#64748b',
              boxShadow: mapStyle === key ? '0 0 12px rgba(14,165,233,0.3)' : 'none',
              letterSpacing:'0.5px',
            }}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
