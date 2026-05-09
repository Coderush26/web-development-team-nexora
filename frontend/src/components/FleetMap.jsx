import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Polygon, Popup, Tooltip, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw';
import { useFleetStore } from '../store/fleetStore.js';

const STATUS_COLOR = {
  normal:'#4ade80', rerouting:'#fbbf24', distressed:'#f87171',
  stopped:'#94a3b8', stranded:'#ef4444', arrived:'#38bdf8',
  out_of_fuel:'#ef4444', insufficient_fuel:'#fbbf24',
};

function makeShipIcon(ship, isSelected) {
  const color = STATUS_COLOR[ship.status] || '#94a3b8';
  const sz = isSelected ? 40 : 32;
  const isAlert = ship.status === 'distressed' || ship.status === 'stranded';
  const pulse = isAlert ? `<circle cx="12" cy="12" r="16" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.4">
    <animate attributeName="r" values="14;24;14" dur="2s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite"/>
  </circle>` : '';
  const ring = isSelected ? `<circle cx="12" cy="12" r="16" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.5" stroke-dasharray="4,3"/>` : '';
  const svg = `<svg width="${sz}" height="${sz}" viewBox="-6 -6 36 36" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
    ${pulse}${ring}
    <path d="M12 0 L20 22 L12 17 L4 22 Z" fill="${color}" stroke="rgba(255,255,255,0.8)" stroke-width="1"
      style="filter:drop-shadow(0 0 ${isSelected?5:2}px ${color})"/>
  </svg>`;
  return L.divIcon({ html: `<div style="transform:rotate(${ship.heading||0}deg)">${svg}</div>`, className:'', iconSize:[sz,sz], iconAnchor:[sz/2,sz/2] });
}

function makePortIcon() {
  const svg = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="6" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1.5"/>
    <circle cx="8" cy="8" r="2.5" fill="#38bdf8"/>
  </svg>`;
  return L.divIcon({ html: svg, className:'', iconSize:[16,16], iconAnchor:[8,8] });
}

function useInterpolatedShips(ships) {
  const prevRef = useRef({});
  const frameRef = useRef(null);
  const [display, setDisplay] = useState(ships);

  useEffect(() => {
    if (!ships.length) return;
    const start = performance.now();
    const prev = {};
    ships.forEach(s => { prev[s.id] = prevRef.current[s.id] || { lat:s.lat, lng:s.lng }; });
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    const DURATION = 950;
    function animate(t) {
      const frac = Math.min((t - start) / DURATION, 1);
      setDisplay(ships.map(s => {
        const p = prev[s.id] || s;
        return { ...s, lat: p.lat + (s.lat-p.lat)*frac, lng: p.lng + (s.lng-p.lng)*frac };
      }));
      if (frac < 1) frameRef.current = requestAnimationFrame(animate);
    }
    frameRef.current = requestAnimationFrame(animate);
    prevRef.current = {};
    ships.forEach(s => { prevRef.current[s.id] = { lat:s.lat, lng:s.lng }; });
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

    map.on('draw:drawstop', () => {
      setDrawing(false);
    });

    return () => {
      map.removeLayer(drawn);
      map.off(L.Draw.Event.CREATED);
      map.off('draw:drawstop');
    };
  }, [map, onZoneDrawn]);

  const startDraw = useCallback(() => {
    if (handlerRef.current) {
      handlerRef.current.disable();
    }
    const handler = new L.Draw.Polygon(map, {
      allowIntersection: false,
      shapeOptions: { color: '#f87171', fillOpacity: 0.12, weight: 2 },
    });
    handler.enable();
    handlerRef.current = handler;
    setDrawing(true);
  }, [map]);

  const cancelDraw = useCallback(() => {
    if (handlerRef.current) {
      handlerRef.current.disable();
      handlerRef.current = null;
    }
    setDrawing(false);
  }, []);

  return (
    <div style={{
      position:'absolute', top:12, right:12, zIndex:1000,
      display:'flex', flexDirection:'column', gap:6,
    }}>
      <button
        id="btn-draw-zone"
        onClick={drawing ? cancelDraw : startDraw}
        style={{
          padding:'10px 14px', borderRadius:8, cursor:'pointer',
          border: drawing ? '2px solid #f87171' : '2px solid rgba(56,189,248,0.4)',
          background: drawing ? 'rgba(248,113,113,0.2)' : 'rgba(17,24,39,0.9)',
          color: drawing ? '#f87171' : '#38bdf8',
          fontSize:13, fontWeight:700, fontFamily:'Inter,sans-serif',
          backdropFilter:'blur(8px)', boxShadow:'0 4px 16px rgba(0,0,0,0.5)',
          display:'flex', alignItems:'center', gap:8,
          transition:'all 0.2s',
        }}
      >
        {drawing ? '✕ Cancel' : '🚫 Draw Restricted Zone'}
      </button>
      {drawing && (
        <div style={{
          padding:'8px 12px', borderRadius:6,
          background:'rgba(248,113,113,0.15)', border:'1px solid rgba(248,113,113,0.3)',
          color:'#fca5a5', fontSize:11, textAlign:'center',
          backdropFilter:'blur(8px)',
        }}>
          Click on map to place points. Click first point to close.
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
    if (s) map.panTo([s.lat, s.lng], { animate:true, duration:0.5 });
  }, [selectedId]);
  return null;
}

export default function FleetMap({ canDraw=false, focusShipId=null }) {
  const ships      = useFleetStore(s => s.ships);
  const zones      = useFleetStore(s => s.zones);
  const ports      = useFleetStore(s => s.ports);
  const selectedId = useFleetStore(s => s.selectedShipId);
  const selectShip = useFleetStore(s => s.selectShip);
  const drawZone   = useFleetStore(s => s.drawZone);
  const removeZone = useFleetStore(s => s.removeZone);
  const display    = useInterpolatedShips(ships);

  const center = focusShipId
    ? (() => { const s = ships.find(x=>x.id===focusShipId); return s?[s.lat,s.lng]:[26.0,56.0]; })()
    : [26.0, 54.0];

  const portIcon = makePortIcon();

  return (
    <MapContainer center={center} zoom={focusShipId?9:6} style={{ width:'100%', height:'100%' }} zoomControl>
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_matter_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap &copy; CARTO' maxZoom={18}/>

      {canDraw && <DrawControl onZoneDrawn={(poly,name)=>drawZone(poly,name,'#f87171')}/>}
      <AutoPan ships={display} selectedId={selectedId} focusId={focusShipId}/>

      {/* Ports - with permanent labels */}
      {(ports||[]).map(port=>(
        <Marker key={port.id||port.name} position={[port.lat,port.lng]} icon={portIcon}>
          <Tooltip direction="right" offset={[10, 0]} permanent className="port-label-tooltip">
            ⚓ {port.name}
          </Tooltip>
          <Popup><div style={{background:'#111827',color:'#f1f5f9',padding:'8px 10px',borderRadius:6,fontSize:13}}>
            ⚓ <strong>{port.name}</strong></div></Popup>
        </Marker>
      ))}

      {/* Restricted zones */}
      {zones.map(zone=>(
        <Polygon key={zone.id} positions={zone.polygon}
          pathOptions={{color:'#f87171',fillColor:'#f87171',fillOpacity:0.10,weight:2,dashArray:'6,4'}}>
          <Popup><div style={{background:'#111827',color:'#f1f5f9',padding:10,minWidth:160,borderRadius:6}}>
            <strong>🚫 {zone.name}</strong>
            {canDraw&&<button className="btn btn-danger btn-sm" style={{width:'100%',marginTop:8}}
              onClick={()=>removeZone(zone.id)}>Remove Zone</button>}
          </div></Popup>
        </Polygon>
      ))}

      {/* Ship paths */}
      {display.map(ship=>{
        if (!ship.path||ship.pathIndex>=ship.path.length-1) return null;
        const rem = ship.path.slice(Math.max(0,ship.pathIndex));
        if (rem.length<2) return null;
        return <Polyline key={`p-${ship.id}`} positions={rem.map(p=>[p.lat,p.lng])}
          pathOptions={{color:STATUS_COLOR[ship.status]||'#38bdf8',opacity:0.3,weight:1.5,dashArray:'5,7'}}/>;
      })}

      {/* Ships - with name labels */}
      {display.map(ship=>(
        <Marker key={ship.id} position={[ship.lat,ship.lng]}
          icon={makeShipIcon(ship, ship.id===selectedId||ship.id===focusShipId)}
          eventHandlers={{click:()=>selectShip(ship.id)}}
          zIndexOffset={ship.id===selectedId?1000:0}>
          <Tooltip direction="bottom" offset={[0, 12]} permanent className="ship-name-tooltip">
            {ship.name}
          </Tooltip>
          <Popup minWidth={230}>
            <div style={{fontFamily:'Inter,sans-serif',background:'#111827',color:'#f1f5f9',padding:12,borderRadius:8}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:6}}>🚢 {ship.name}</div>
              <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'3px 10px',fontSize:12,color:'#94a3b8'}}>
                <span>Status</span><span style={{color:STATUS_COLOR[ship.status],fontWeight:600}}>{ship.status.replace(/_/g,' ')}</span>
                <span>Speed</span><span style={{fontWeight:600,color:'#f1f5f9'}}>{ship.speed} kn · {Math.round(ship.heading)}°</span>
                <span>Cargo</span><span style={{fontWeight:600,color:'#f1f5f9'}}>{ship.cargo}</span>
                <span>Dest.</span><span style={{fontWeight:600,color:'#38bdf8'}}>{ship.destination}</span>
                <span>Weather</span><span style={{color:ship.weather?.isAdverse?'#fbbf24':'#4ade80'}}>{ship.weather?.description||'Clear'}</span>
              </div>
              <div style={{marginTop:8}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:2,color:'#94a3b8'}}>
                  <span>Fuel</span>
                  <span>{ship.fuel?.toFixed(0)} / {ship.maxFuel} t {ship.predictedFuelShortfall?'⚠️':''}</span>
                </div>
                <div style={{height:4,background:'rgba(255,255,255,0.1)',borderRadius:4,overflow:'hidden'}}>
                  <div style={{height:'100%',borderRadius:4,transition:'width 0.5s',
                    width:`${ship.maxFuel>0?(ship.fuel/ship.maxFuel)*100:50}%`,
                    background:ship.fuel/ship.maxFuel>0.5?'#4ade80':ship.fuel/ship.maxFuel>0.2?'#fbbf24':'#f87171'}}/>
                </div>
              </div>
              {ship.weather?.isAdverse&&<div style={{marginTop:5,fontSize:11,color:'#fbbf24'}}>⛈️ +30% fuel burn active</div>}
            </div>
          </Popup>
        </Marker>
      ))}

      {/* Distress rings */}
      {display.filter(s=>s.status==='distressed').map(s=>(
        <Circle key={`dr-${s.id}`} center={[s.lat,s.lng]} radius={8000}
          pathOptions={{color:'#f87171',fillOpacity:0.04,weight:1,dashArray:'4,4'}}/>
      ))}

      {/* Selected ring */}
      {selectedId&&(()=>{
        const s=display.find(x=>x.id===selectedId);
        if (!s) return null;
        return <Circle key="sel" center={[s.lat,s.lng]} radius={2500}
          pathOptions={{color:STATUS_COLOR[s.status]||'#38bdf8',fillOpacity:0.05,weight:1.5}}/>;
      })()}
    </MapContainer>
  );
}
