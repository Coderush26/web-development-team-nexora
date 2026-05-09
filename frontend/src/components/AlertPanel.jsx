import { useFleetStore } from '../store/fleetStore.js';
import { formatDistanceToNow } from 'date-fns';

const SEVERITY_ICON = { critical:'🔴', warning:'🟡', info:'🔵' };

export default function AlertPanel() {
  const alerts = useFleetStore(s => s.alerts);
  const acknowledgeAlert = useFleetStore(s => s.acknowledgeAlert);

  const sorted = [...alerts].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="alert-list">
      {sorted.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">✅</div>
          <div>No active alerts</div>
        </div>
      )}
      {sorted.map(alert => (
        <div
          key={alert.id}
          className={`alert-item ${alert.severity} ${alert.acknowledged ? 'acknowledged' : ''}`}
          id={`alert-${alert.id}`}
        >
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
            <div style={{ flex:1 }}>
              <div className="alert-msg">
                {SEVERITY_ICON[alert.severity]} {alert.message}
              </div>
              <div className="alert-time">
                {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}
                {alert.acknowledged && ' · Acknowledged'}
              </div>
            </div>
            {!alert.acknowledged && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => acknowledgeAlert(alert.id)}
                title="Acknowledge"
                style={{ flexShrink:0 }}
              >✓</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
