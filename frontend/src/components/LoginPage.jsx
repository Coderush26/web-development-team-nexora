import { useState } from 'react';
import { useFleetStore } from '../store/fleetStore.js';

const SHIPS_PREVIEW = [
  { id:'MV-1',  name:'Aurora'   }, { id:'MV-2',  name:'Borealis' },
  { id:'MV-3',  name:'Cygnus'   }, { id:'MV-4',  name:'Dragon'   },
  { id:'MV-5',  name:'Emerald'  }, { id:'MV-6',  name:'Falcon'   },
  { id:'MV-7',  name:'Gharial'  }, { id:'MV-8',  name:'Halcyon'  },
  { id:'MV-9',  name:'Iris'     }, { id:'MV-10', name:'Jade'     },
  { id:'MV-11', name:'Kite'     }, { id:'MV-12', name:'Lotus'    },
  { id:'MV-13', name:'Mirage'   }, { id:'MV-14', name:'Nova'     },
  { id:'MV-15', name:'Orca'     },
];

export default function LoginPage() {
  const [role, setRole] = useState(null);
  const [shipId, setShipId] = useState('MV-1');
  const connect = useFleetStore(s => s.connect);

  function handleJoin() {
    if (!role) return;
    connect(role, role === 'captain' ? shipId : null);
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🚢</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -1 }}>Fleet Crisis Ops</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 6, fontSize: 13 }}>
            Strait of Hormuz · Real-time Command System
          </p>
          <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop:12 }}>
            <span style={{ fontSize:11, padding:'2px 8px', borderRadius:12, background:'rgba(74,222,128,0.1)', color:'var(--accent-green)', border:'1px solid rgba(74,222,128,0.25)' }}>
              ● LIVE SIMULATION
            </span>
            <span style={{ fontSize:11, padding:'2px 8px', borderRadius:12, background:'rgba(56,189,248,0.1)', color:'var(--accent-blue)', border:'1px solid rgba(56,189,248,0.25)' }}>
              15 ACTIVE SHIPS
            </span>
          </div>
        </div>

        {/* Role selection */}
        <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.8px' }}>Select Your Role</p>

        <div
          className={`role-option ${role === 'command' ? 'selected' : ''}`}
          onClick={() => setRole('command')}
          id="role-command"
        >
          <span className="role-icon">🎖️</span>
          <div>
            <div className="role-label">Fleet Command</div>
            <div className="role-desc">Full fleet visibility · Draw restricted zones · Issue directives · AI advisor</div>
          </div>
        </div>

        <div
          className={`role-option ${role === 'captain' ? 'selected' : ''}`}
          onClick={() => setRole('captain')}
          id="role-captain"
        >
          <span className="role-icon">⚓</span>
          <div>
            <div className="role-label">Ship Captain</div>
            <div className="role-desc">Single ship view · Receive & respond to directives · Send distress calls</div>
          </div>
        </div>

        {/* Ship selector for captain */}
        {role === 'captain' && (
          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">Select Your Ship</label>
            <select
              className="form-select"
              value={shipId}
              onChange={e => setShipId(e.target.value)}
              id="ship-selector"
            >
              {SHIPS_PREVIEW.map(s => (
                <option key={s.id} value={s.id}>{s.id} · {s.name}</option>
              ))}
            </select>
          </div>
        )}

        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 20, padding: '12px', fontSize: 14, justifyContent: 'center' }}
          onClick={handleJoin}
          disabled={!role}
          id="btn-join"
        >
          {role === 'command' ? '🎖️ Enter Command Center' : role === 'captain' ? '⚓ Board Ship' : 'Select a Role to Continue'}
        </button>

        <p style={{ textAlign:'center', marginTop:16, fontSize:11, color:'var(--text-muted)' }}>
          Multiple sessions can connect simultaneously
        </p>
      </div>
    </div>
  );
}
