import { useState } from 'react';
import { useFleetStore } from '../store/fleetStore.js';

export default function AIAdvisor() {
  const advice = useFleetStore(s => s.aiAdvice);
  const requestAdvice = useFleetStore(s => s.requestAdvice);
  const [loading, setLoading] = useState(false);

  async function handleRequest() {
    setLoading(true);
    requestAdvice();
    setTimeout(() => setLoading(false), 3000);
  }

  const TYPE_ICON = { reroute:'🔀', zone:'🚫', assistance:'🆘', alert:'⚠️' };

  return (
    <div style={{ padding:12, overflow:'auto', flex:1 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <span style={{ fontSize:12, fontWeight:700, color:'var(--accent-blue)' }}>🤖 AI Fleet Advisor</span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleRequest}
          disabled={loading}
          id="btn-request-advice"
        >
          {loading ? <span className="spinner">⟳</span> : '⚡'} Analyze
        </button>
      </div>

      {advice.length === 0 && !loading && (
        <div className="empty-state">
          <div className="empty-icon">🤖</div>
          <div style={{ fontSize:12 }}>Click Analyze for AI recommendations</div>
        </div>
      )}

      {advice.map((item, i) => (
        <div key={i} className="advice-item">
          <div className="advice-title">
            {TYPE_ICON[item.type] || '💡'} {item.title}
          </div>
          <div className="advice-reasoning">{item.reasoning}</div>
          <div style={{ marginTop:6, fontSize:11, color:'var(--accent-cyan)', fontStyle:'italic' }}>
            → {item.action}
          </div>
          {item.shipId && (
            <div style={{ marginTop:4, fontSize:10, color:'var(--text-muted)' }}>
              Ship: {item.shipId}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
