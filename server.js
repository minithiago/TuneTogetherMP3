/* =========================================================
   TuneTogether 2K — real-time server
   - Serves the static app (index.html)
   - WebSocket sync: authoritative room state, presence, chat
   - Sends serverTime with every message so clients can align
     their clocks and keep playback in sync across devices.
   ========================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';   // listen on all interfaces (LAN access)
const ROOT = __dirname;

// ---------- tiny static file server ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath));

  // prevent path traversal outside project root
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- rooms ----------
// code -> { state, chat:[], clients: Map(ws -> user) }
const rooms = new Map();

function defaultState() {
  return { queue: [], current: -1, playing: false, startedAt: 0, position: 0, updatedBy: '' };
}
function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { state: defaultState(), chat: [], clients: new Map() });
  return rooms.get(code);
}
function peopleOf(room) {
  return [...room.clients.values()].map(u => ({ id: u.id, name: u.name, color: u.color }));
}
function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(room, obj, exceptWs) {
  const msg = JSON.stringify(obj);
  for (const ws of room.clients.keys()) {
    if (ws !== exceptWs && ws.readyState === ws.OPEN) ws.send(msg);
  }
}
function sysChat(room, text) {
  const m = { sys: true, text, t: Date.now() };
  room.chat.push(m);
  if (room.chat.length > 300) room.chat.shift();
  broadcast(room, { type: 'chat', message: m, serverTime: Date.now() });
}
function sendPresence(room) {
  broadcast(room, { type: 'presence', people: peopleOf(room), serverTime: Date.now() });
}

// ---------- websocket ----------
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let room = null, roomCode = null, user = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'join') {
      roomCode = String(m.room || '').toUpperCase().slice(0, 12) || 'LOBBY';
      user = {
        id: String(m.user?.id || Math.random().toString(36).slice(2)).slice(0, 32),
        name: String(m.user?.name || 'anon').slice(0, 24),
        color: /^#[0-9a-fA-F]{3,8}$/.test(m.user?.color || '') ? m.user.color : '#2b6cff'
      };
      room = getRoom(roomCode);
      room.clients.set(ws, user);

      // full snapshot to the newcomer
      send(ws, {
        type: 'welcome',
        state: room.state,
        chat: room.chat,
        people: peopleOf(room),
        serverTime: Date.now()
      });
      sendPresence(room);
      sysChat(room, `👋 ${user.name} joined the room`);
      console.log(`[${roomCode}] ${user.name} joined — ${room.clients.size} online`);
      return;
    }

    if (!room) return; // must join first

    switch (m.type) {
      case 'state':
        if (m.state && typeof m.state === 'object') {
          room.state = m.state;
          broadcast(room, { type: 'state', state: room.state, serverTime: Date.now() }, ws);
        }
        break;

      case 'chat':
        if (m.message && typeof m.message.text === 'string') {
          const msg = {
            name: String(m.message.name || user.name).slice(0, 24),
            color: m.message.color || user.color,
            text: String(m.message.text).slice(0, 240),
            sys: !!m.message.sys,
            t: Date.now()
          };
          room.chat.push(msg);
          if (room.chat.length > 300) room.chat.shift();
          broadcast(room, { type: 'chat', message: msg, serverTime: Date.now() }, ws);
        }
        break;

      case 'presence': // name/color update
        if (m.user) {
          user.name = String(m.user.name || user.name).slice(0, 24);
          user.color = m.user.color || user.color;
          room.clients.set(ws, user);
          sendPresence(room);
        }
        break;

      case 'ping':
        send(ws, { type: 'pong', serverTime: Date.now(), echo: m.t });
        break;
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.clients.delete(ws);
    if (room.clients.size === 0) {
      // empty room: keep the queue/state briefly, then clean up after 10 min
      const code = roomCode;
      setTimeout(() => {
        const r = rooms.get(code);
        if (r && r.clients.size === 0) { rooms.delete(code); console.log(`[${code}] cleaned up`); }
      }, 10 * 60 * 1000);
    } else {
      sendPresence(room);
      if (user) sysChat(room, `👋 ${user.name} left`);
    }
    if (user) console.log(`[${roomCode}] ${user.name} left — ${room.clients.size} online`);
  });
});

// drop dead sockets
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  console.log('==============================================');
  console.log(' TuneTogether 2K server is live');
  console.log(` Local:   http://localhost:${PORT}`);
  console.log(` Network: http://<your-LAN-IP>:${PORT}  (share with friends on the same Wi-Fi)`);
  console.log('==============================================');
});
