// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const WATCH_FILE = path.join(DATA_DIR, 'watchlist.json');
const KEYS_FILE = path.join(DATA_DIR, 'keys.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
if (!fs.existsSync(WATCH_FILE)) fs.writeFileSync(WATCH_FILE, JSON.stringify({}));
if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, JSON.stringify([]));
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}));

function readJSON(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')||'null'); } catch(e){ return null; } }
function writeJSON(p,obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

const AUTO_COINS = ['BTCUSDT','ETHUSDT','SOLUSDT','DOGEUSDT','BNBUSDT'];
const AUTO_INTERVAL_MIN = 10; // chạy mỗi 10 phút
const SPECIAL_PHONE = process.env.SPECIAL_PHONE || '0399834208';

app.use(cors());
app.use(express.json());

// serve client build
app.use(express.static(path.join(__dirname, '..', 'client', 'build')));

// ---- helper get client IP ----
function getIp(req){
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress;
}

// ---- SESSION & KEYS ----
function loadSessions(){ return readJSON(SESSIONS_FILE) || {}; }
function saveSessions(s){ writeJSON(SESSIONS_FILE, s); }
function loadKeys(){ return readJSON(KEYS_FILE) || []; }
function saveKeys(k){ writeJSON(KEYS_FILE, k); }

function createSession(phone, role='guest'){
  const s = loadSessions();
  const token = uuidv4();
  s[token] = { phone, role, created: Date.now() };
  saveSessions(s);
  return token;
}

function requireAuth(req,res,next){
  const auth = req.headers.authorization;
  if (!auth) { req.user = null; return next(); }
  const token = (auth||'').replace(/^Bearer\s+/i,'');
  const s = loadSessions();
  if (s[token]) req.user = s[token]; else req.user = null;
  next();
}

app.use(requireAuth);

// ---- TIME-BASED DYNAMIC KEY ALGORITHM for SPECIAL_PHONE ----
function generateTimeBasedKey(){
  const now = new Date();
  const hh = now.getHours();
  const mm = now.getMinutes();
  const hhmm = String(hh).padStart(2,'0') + String(mm).padStart(2,'0');
  let out = '';
  for (const ch of hhmm){
    const d = parseInt(ch);
    if (d % 2 === 0) out += String(Math.floor(d/2));
    else out += String(d % 3);
  }
  return 'K' + out; // ví dụ: K13... (hợp lệ tại thời điểm nhập)
}

// ---- BINANCE FUTURES KLINES fetch ----
async function fetchKlines(symbol, interval='15m', limit=200){
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await axios.get(url, { timeout: 15000 });
    return res.data.map(c => ({ t:c[0], open:parseFloat(c[1]), high:parseFloat(c[2]), low:parseFloat(c[3]), close:parseFloat(c[4]), vol:parseFloat(c[5]) }));
  } catch(e){
    console.log('fetchKlines err', e.message);
    return [];
  }
}

// ---- copy of analysis helpers from your sample (BOS/OB/FVG/Sweep/Patterns) ----
function detectBOS(candles, lookback=20){
  if (candles.length < lookback) return null;
  const slice = candles.slice(-lookback);
  const last = slice[slice.length-1];
  const highs = slice.map(c=>c.high);
  const lows = slice.map(c=>c.low);
  const recentHigh = Math.max(...highs.slice(0, highs.length-1));
  const recentLow = Math.min(...lows.slice(0, lows.length-1));
  if (last.close > recentHigh) return {type:'BOS_UP', price: last.close};
  if (last.close < recentLow) return {type:'BOS_DOWN', price: last.close};
  return null;
}

function detectOrderBlock(candles){
  if (candles.length < 6) return {};
  const last5 = candles.slice(-6, -1);
  const blocks = {bullish:null,bearish:null};
  for (let i=0;i<last5.length;i++){
    const c = last5[i];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low || 1e-9;
    if (body > range*0.6){
      if (c.close > c.open) blocks.bullish = c;
      else blocks.bearish = c;
    }
  }
  return blocks;
}

function detectFVG(candles){
  if (candles.length < 5) return null;
  for (let i = candles.length-3; i >= 2; i--){
    const c = candles[i];
    const c2 = candles[i-2];
    if (!c || !c2) continue;
    if (c.low > c2.high) return {type:'FVG_UP', idx:i, low:c2.high, high:c.low};
    if (c.high < c2.low) return {type:'FVG_DOWN', idx:i, low:c.high, high:c2.low};
  }
  return null;
}

function detectSweep(candles){
  if (candles.length < 3) return null;
  const last = candles[candles.length-1], prev = candles[candles.length-2];
  if (last.high > prev.high && last.close < prev.close) return 'LIQUIDITY_SWEEP_TOP';
  if (last.low < prev.low && last.close > prev.close) return 'LIQUIDITY_SWEEP_BOTTOM';
  return null;
}

function detectCandlePattern(candles){
  const n = candles.length;
  if (n < 2) return null;
  const last = candles[n-1], prev = candles[n-2];
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low || 1e-9;
  const upper = last.high - Math.max(last.open,last.close);
  const lower = Math.min(last.open,last.close) - last.low;
  if (body < range*0.3 && upper > lower*2) return 'ShootingStar';
  if (body < range*0.3 && lower > upper*2) return 'Hammer';
  if (last.close > prev.open && last.open < prev.close && last.close > last.open) return 'BullishEngulfing';
  if (last.close < prev.open && last.open > prev.close && last.close < last.open) return 'BearishEngulfing';
  return null;
}

function computeConfidence({bos, fvg, pattern, ob, sweep}){
  // simple point-based confidence
  let score = 0;
  if (bos) score += 2;
  if (fvg) score += 1;
  if (pattern) score += 1;
  if (sweep) score += 1;
  if (ob && (ob.bullish || ob.bearish)) score += 1;
  return score; // higher better
}

function generateIdea(symbol, price, ict, fvg, pattern, bos, ob, sweep){
  let dir = null;
  if ((bos && bos.type === 'BOS_UP') || (fvg && fvg.type === 'FVG_UP') || (pattern && /Bull|Hammer/.test(pattern))) dir='LONG';
  if ((bos && bos.type === 'BOS_DOWN') || (fvg && fvg.type === 'FVG_DOWN') || (pattern && /Bear|Shooting/.test(pattern))) dir='SHORT';

  if (!dir) return {ok:false, reason:'No confluence (ICT/PA/SMC không đồng thuận)'};

  const entry = price;
  const sl = dir==='LONG' ? +(price*0.99).toFixed(2) : +(price*1.01).toFixed(2);
  const tp = dir==='LONG' ? +(price*1.02).toFixed(2) : +(price*0.98).toFixed(2);
  const rr = Math.abs((tp-entry)/(entry-sl)).toFixed(2);
  const note = `${dir} reason:${bos?bos.type:''} ${fvg?fvg.type:''} ${pattern||''}`;
  const conf = computeConfidence({bos,fvg,pattern,ob,sweep});
  return {ok:true, symbol, dir, entry, sl, tp, rr, note, confidence:conf};
}

// ---- HISTORY helpers ----
function readHistory(){ return readJSON(HISTORY_FILE) || []; }
function saveHistory(arr){ writeJSON(HISTORY_FILE, arr); }
function pushHistory(record){ const arr = readHistory(); record._time = Date.now(); arr.unshift(record); if (arr.length>2000) arr.splice(2000); saveHistory(arr); }

// ---- fullAnalysis wrapper ----
async function fullAnalysis(symbol){
  const klines15 = await fetchKlines(symbol,'15m',200);
  const klines1h = await fetchKlines(symbol,'1h',200);
  const klines4h = await fetchKlines(symbol,'4h',200);

  if (!klines15.length) return {ok:false, reason:'no data'};

  const price = klines15[klines15.length-1].close;
  const bos15 = detectBOS(klines15,20);
  const ob15 = detectOrderBlock(klines15);
  const fvg15 = detectFVG(klines15);
  const sweep15 = detectSweep(klines15);
  const pattern15 = detectCandlePattern(klines15);

  const idea = generateIdea(symbol, price, bos15, fvg15, pattern15, bos15 || null, ob15, sweep15);

  const result = {
    ok:true,
    symbol,
    price,
    timeframe:'15m',
    bos15, ob15, fvg15, sweep15, pattern15,
    idea
  };
  return result;
}

// ---- autoScanAll ----
async function autoScanAll(){
  try{
    const coins = AUTO_COINS;
    for (const s of coins){
      const r = await fullAnalysis(s);
      if (!r.ok) continue;
      if (r.idea && r.idea.ok){
        // check history for same symbol within short window
        const hist = readHistory();
        const existing = hist.find(h => h.symbol === s && (Date.now() - h._time) < (20*60*1000));
        if (existing){
          if ((r.idea.confidence || 0) > (existing.analysis.idea.confidence || 0)){
            // supersede
            const newHist = hist.filter(h => !(h.symbol===s && (Date.now() - h._time) < (20*60*1000)));
            saveHistory(newHist);
          } else {
            // new one less confident => still send but keep old in history
          }
        }

        // save and broadcast
        pushHistory({symbol:s, analysis:r, auto:true});
        io.emit('analysis', {symbol:s, analysis:r, ts:Date.now()});
      }
    }

    // per-user watchlist notifications
    const watch = readJSON(WATCH_FILE) || {};
    for (const chat in watch){
      const list = watch[chat]||[];
      for (const s of list){
        const r = await fullAnalysis(s);
        if (r.idea && r.idea.ok){
          io.emit('watch-alert', {to: chat, symbol:s, analysis:r});
          pushHistory({symbol:s, analysis:r, auto:true, sentTo:chat});
        }
      }
    }
  } catch(e){ console.log('autoScanAll err', e.message); }
}

// start interval
setInterval(autoScanAll, AUTO_INTERVAL_MIN * 60 * 1000);

// initial run
autoScanAll();

// ---- HTTP API ----
app.get('/api/ping', (req,res)=> res.json({ok:true, ts:Date.now()}));

app.post('/api/login', (req,res)=>{
  const { phone, key } = req.body || {};
  const ip = getIp(req);
  if (!phone) return res.status(400).json({ok:false, reason:'phone required'});

  // special phone path
  if (phone === SPECIAL_PHONE){
    const dyn = generateTimeBasedKey();
    // if key matches dynamic key => admin session
    if (key && key === dyn){
      const token = createSession(phone, 'admin');
      return res.json({ok:true, token, role:'admin', phone});
    }
    // else check stored long term keys
    const keys = loadKeys();
    const found = keys.find(k=>k.phone===phone && k.token===key && (new Date(k.expiry).getTime() > Date.now()));
    if (found){
      // bind ip if not bound
      if (!found.allowedIp){ found.allowedIp = ip; saveKeys(keys); }
      if (found.allowedIp !== ip) return res.status(403).json({ok:false, reason:'Key bound to another IP'});
      const token = createSession(phone, 'admin');
      return res.json({ok:true, token, role:'admin', phone});
    }
    // otherwise allow guest access (no token) but limited
    return res.json({ok:true, token:createSession(phone,'guest'), role:'guest', phone, notice:'special phone: dynamic key not provided'});
  }

  // non-special phones
  const keys = loadKeys();
  const found = keys.find(k=>k.phone===phone && k.token===key && (new Date(k.expiry).getTime() > Date.now()));
  if (found){
    if (!found.allowedIp){ found.allowedIp = ip; saveKeys(keys); }
    if (found.allowedIp !== ip) return res.status(403).json({ok:false, reason:'Key bound to another IP'});
    const token = createSession(phone, 'user');
    return res.json({ok:true, token, role:'user', phone});
  }

  // no key => guest session (can still view analysis)
  const token = createSession(phone, 'guest');
  return res.json({ok:true, token, role:'guest', phone});
});

app.post('/api/create-key', (req,res)=>{
  // admin only
  const auth = (req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const sessions = loadSessions();
  const s = sessions[auth];
  if (!s || s.role!=='admin') return res.status(403).json({ok:false, reason:'admin only'});
  const { type='week', phone } = req.body || {};
  const now = Date.now();
  let expiry = new Date();
  if (type === 'week') expiry.setDate(expiry.getDate()+7);
  else expiry.setDate(expiry.getDate()+30);
  const token = uuidv4().replace(/-/g,'').slice(0,16).toUpperCase();
  const keys = loadKeys();
  keys.push({ token, phone: phone || s.phone, type, expiry: expiry.toISOString(), allowedIp: null, createdAt: new Date().toISOString() });
  saveKeys(keys);
  return res.json({ok:true, token, expiry: expiry.toISOString()});
});

app.post('/api/scan', async (req,res)=>{
  const { symbol } = req.body || {};
  if (!symbol) return res.status(400).json({ok:false, reason:'symbol required'});
  const r = await fullAnalysis(symbol.toUpperCase());
  if (!r.ok) return res.status(500).json({ok:false, reason:r.reason});
  // push to history and broadcast if idea.ok
  if (r.idea && r.idea.ok){ pushHistory({symbol:r.symbol, analysis:r, auto:false}); io.emit('analysis', {symbol:r.symbol, analysis:r, ts:Date.now()}); }
  res.json({ok:true, analysis:r});
});

app.get('/api/history', (req,res)=>{
  const h = readHistory();
  res.json({ok:true, history: h.slice(0,200)});
});

app.get('/api/keys', (req,res)=>{
  // only admin
  const auth = (req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const sessions = loadSessions();
  const s = sessions[auth];
  if (!s || s.role!=='admin') return res.status(403).json({ok:false, reason:'admin only'});
  res.json({ok:true, keys: loadKeys()});
});

app.get('/api/coins', (req,res)=>{
  res.json({ok:true, coins: AUTO_COINS});
});

// fallback to client
app.get('*', (req,res)=>{
  res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('Server started on', PORT));

// Websocket handlers (optional tracking of connected users)
io.on('connection', (socket)=>{
  console.log('socket connected', socket.id);
  socket.on('hello', data => { /* can record user */ });
  socket.on('disconnect', ()=> console.log('socket disconnected', socket.id));
});
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// serve client build
app.use(express.static(path.join(__dirname, "../client/dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist", "index.html"));
});
