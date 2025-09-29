import React, { useEffect, useState } from 'react';
import socket from './socket';
import API from './api';

function FullScreenLogin({onLogin}){
  const [phone, setPhone] = useState('');
  const [key, setKey] = useState('');
  const [notice, setNotice] = useState('');

  const sendSmsHref = `sms:0399834208?body=${encodeURIComponent('OTP TRADING')}`;

  async function doLogin(asGuest=false){
    try{
      const { data } = await API.post('/login',{ phone, key: asGuest?undefined:key });
      if (data.ok){
        onLogin({ token: data.token, role:data.role, phone });
      } else alert(JSON.stringify(data));
    } catch(e){ alert('Login error'); }
  }

  return (
    <div style={{height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#031027',color:'#fff',flexDirection:'column'}}>
      <h2>Đăng nhập - Nhập SĐT</h2>
      <input placeholder="Số điện thoại" value={phone} onChange={e=>setPhone(e.target.value)} style={{padding:10,fontSize:18}} />
      <div style={{marginTop:8}}>
        <a href={sendSmsHref} style={{color:'#0af',display:'inline-block',marginRight:10}}>Gửi SMS (mở app SMS)</a>
        <button onClick={()=>setNotice('Hãy gửi SMS: "OTP TRADING" tới 0399834208')} style={{padding:8}}>Hướng dẫn</button>
      </div>
      <div style={{marginTop:12}}>
        <input placeholder="Nhập key (nếu có)" value={key} onChange={e=>setKey(e.target.value)} style={{padding:10,fontSize:16}} />
      </div>
      <div style={{marginTop:12}}>
        <button onClick={()=>doLogin(false)} style={{padding:'8px 16px',marginRight:8}}>Đăng nhập</button>
        <button onClick={()=>doLogin(true)} style={{padding:'8px 16px'}}>Vào như Guest</button>
      </div>
      <p style={{marginTop:12,color:'#ccc'}}>{notice}</p>
    </div>
  );
}

function Dashboard({session, onLogout}){
  const [coins, setCoins] = useState([]);
  const [events, setEvents] = useState([]);
  const [history, setHistory] = useState([]);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [phone, setPhone] = useState(session.phone);
  const [role, setRole] = useState(session.role);
  const [newKeyType, setNewKeyType] = useState('week');

  useEffect(()=>{ API.get('/coins').then(r=>setCoins(r.data.coins)); API.get('/history').then(r=>setHistory(r.data.history)); },[]);

  useEffect(()=>{
    socket.on('analysis', data=>{
      setEvents(ev => [data, ...ev].slice(0,50));
    });
    socket.on('watch-alert', data=>{
      setEvents(ev => [{type:'watch', ...data}, ...ev].slice(0,50));
    });
    return ()=>{ socket.off('analysis'); socket.off('watch-alert'); };
  },[]);

  async function doScan(){
    try{
      const r = await API.post('/scan',{ symbol });
      if (r.data.ok) setEvents(ev=>[ {symbol, analysis:r.data.analysis, ts:Date.now()}, ...ev ]);
    } catch(e){ alert('scan error'); }
  }

  async function createKey(){
    try{
      const token = session.token;
      const r = await API.post('/create-key',{ type:newKeyType, phone }, { headers:{ Authorization: `Bearer ${token}` } });
      if (r.data.ok) alert('Tạo key thành công: ' + r.data.token + '\nExpiry: ' + r.data.expiry);
    } catch(e){ alert('Không tạo được key (admin only)'); }
  }

  return (
    <div style={{padding:20}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h3>Futures Analysis</h3>
        <div>
          <span style={{marginRight:12}}>{session.phone} ({role})</span>
          <button onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div style={{marginTop:12}}>
        <strong>Manual scan</strong>
        <div>
          <input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} />
          <button onClick={doScan}>Scan</button>
        </div>
      </div>

      <div style={{marginTop:12}}>
        <h4>Auto events (realtime)</h4>
        <div style={{maxHeight:300,overflow:'auto',border:'1px solid #ddd',padding:8}}>
          {events.map((ev,i)=> (
            <div key={i} style={{padding:8,borderBottom:'1px solid #eee'}}>
              <div><strong>{ev.symbol}</strong> @ {ev.analysis?.price || ''}</div>
              {ev.analysis?.idea?.ok ? (
                <div>➡ {ev.analysis.idea.dir} Entry:{ev.analysis.idea.entry} SL:{ev.analysis.idea.sl} TP:{ev.analysis.idea.tp} (conf:{ev.analysis.idea.confidence})</div>
              ) : <div>— No idea</div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{marginTop:12}}>
        <h4>History (recent)</h4>
        <div style={{maxHeight:200,overflow:'auto',border:'1px solid #ddd',padding:8}}>
          {history.map((h,i)=> (
            <div key={i} style={{padding:6,borderBottom:'1px solid #eee'}}>
              <div>{new Date(h._time).toLocaleString()} | {h.symbol}</div>
              <div>{h.analysis.idea && h.analysis.idea.ok ? `${h.analysis.idea.dir} ${h.analysis.idea.entry} (conf:${h.analysis.idea.confidence})` : 'No Idea'}</div>
            </div>
          ))}
        </div>
      </div>

      {role === 'admin' && (
        <div style={{marginTop:20,padding:12,border:'1px solid #ccc'}}>
          <h4>Admin: Tạo Key</h4>
          <select value={newKeyType} onChange={e=>setNewKeyType(e.target.value)}>
            <option value="week">1 Week</option>
            <option value="month">1 Month</option>
          </select>
          <input value={phone} onChange={e=>setPhone(e.target.value)} style={{marginLeft:8}} />
          <button onClick={createKey} style={{marginLeft:8}}>Tạo Key</button>
        </div>
      )}

    </div>
  );
}

export default function App(){
  const [session, setSession] = useState(null);

  useEffect(()=>{
    const stored = localStorage.getItem('fa_session');
    if (stored) setSession(JSON.parse(stored));
  },[]);

  function handleLogin(sess){
    localStorage.setItem('fa_session', JSON.stringify(sess));
    setSession(sess);
  }

  function handleLogout(){ localStorage.removeItem('fa_session'); setSession(null); }

  if (!session) return <FullScreenLogin onLogin={handleLogin} />;
  return <Dashboard session={session} onLogout={handleLogout} />;
        }
