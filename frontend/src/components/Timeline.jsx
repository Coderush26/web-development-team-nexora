import { useState, useEffect } from 'react';
import { useFleetStore } from '../store/fleetStore.js';
import { format } from 'date-fns';

export default function Timeline() {
  const playbackData = useFleetStore(s => s.playbackData);
  const playbackTs = useFleetStore(s => s.playbackTs);
  const setPlaybackTs = useFleetStore(s => s.setPlaybackTs);
  const requestPlayback = useFleetStore(s => s.requestPlayback);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open && !playbackData) requestPlayback();
  }, [open]);

  const snaps = playbackData?.snapshots || [];
  const events = playbackData?.events || [];

  const minTs = snaps.length > 0 ? snaps[0].timestamp : Date.now() - 3600000;
  const maxTs = snaps.length > 0 ? snaps[snaps.length - 1].timestamp : Date.now();
  const range = maxTs - minTs || 1;

  function handleScrub(e) {
    const pct = parseFloat(e.target.value) / 100;
    const ts = minTs + pct * range;
    setPlaybackTs(ts);
    // Apply snapshot to ships
    const snap = snaps.reduce((best, s) => (s.timestamp <= ts ? s : best), snaps[0]);
    if (snap) useFleetStore.setState({ ships: snap.ships, zones: snap.zones });
  }

  function goLive() {
    setPlaybackTs(null);
  }

  if (!open) {
    return (
      <div className="map-overlay-bl">
        <button className="btn btn-ghost" onClick={() => setOpen(true)} id="btn-timeline-open"
          style={{ fontSize:12 }}>
          ⏱️ Playback
        </button>
      </div>
    );
  }

  const scrubPct = playbackTs ? Math.min(100, ((playbackTs - minTs) / range) * 100) : 100;

  return (
    <div className="timeline-bar">
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6 }}>
        <span style={{ fontSize:12, fontWeight:700, color:'var(--accent-blue)' }}>⏱️ Playback</span>
        {playbackTs && (
          <span style={{ fontSize:11, fontFamily:'JetBrains Mono', color:'var(--text-secondary)' }}>
            {format(new Date(playbackTs), 'HH:mm:ss')}
          </span>
        )}
        {playbackTs && (
          <button className="btn btn-success btn-sm" onClick={goLive} id="btn-go-live">
            ● Live
          </button>
        )}
        {!playbackTs && (
          <span className="live-pill" style={{ fontSize:10 }}><span className="live-dot" />LIVE</span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); goLive(); }}
          style={{ marginLeft:'auto' }}>✕</button>
      </div>

      <input
        type="range" min={0} max={100} step={0.1}
        value={scrubPct}
        onChange={handleScrub}
        className="timeline-scrubber"
        id="timeline-scrubber"
        style={{ width:'100%' }}
      />

      <div className="timeline-labels">
        <span>{snaps.length > 0 ? format(new Date(minTs), 'HH:mm') : '-1h'}</span>
        <span>{snaps.length} snapshots · {events.length} events</span>
        <span>Live</span>
      </div>

      {/* Events bar */}
      <div style={{ position:'relative', height:18, marginTop:4, background:'rgba(255,255,255,0.03)', borderRadius:3 }}>
        {events.slice(-80).map((ev, i) => {
          const pct = ((ev.timestamp - minTs) / range) * 100;
          const color = ev.type === 'ALERT' && ev.payload?.severity === 'critical' ? '#f87171'
            : ev.type === 'ZONE_ADDED' ? '#fbbf24'
            : '#38bdf8';
          return (
            <div key={i} title={`${ev.type} @ ${format(new Date(ev.timestamp), 'HH:mm:ss')}`}
              style={{ position:'absolute', left:`${pct}%`, top:3, width:2, height:12, background:color, borderRadius:1 }} />
          );
        })}
      </div>
    </div>
  );
}
