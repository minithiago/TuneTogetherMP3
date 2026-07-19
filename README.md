# TuneTogether 2K 🎧

Listen to music with friends — synced playback, shared rooms, collaborative queue,
live chat and real-time presence. Y2K / Frutiger Aero blue-chrome aesthetic.

## Run it

```bash
npm install      # first time only (installs the `ws` websocket library)
npm start        # starts the server on http://localhost:3000
```

Then open **http://localhost:3000** in your browser.

## Invite friends

### Same Wi-Fi / LAN (easiest)
Friends on the same network open:

```
http://192.168.18.71:3000
```

(That's this machine's current local IP — re-check with `ipconfig` if it changes.)
Everyone joins the **same room code** (or opens the "Copy link" URL) and you're synced.

> Windows may show a firewall prompt the first time — allow Node.js on **Private networks**
> so friends on your Wi-Fi can reach the server.

### Over the internet (friends anywhere)
The LAN IP only works on your network. To let remote friends in, expose port 3000 with a
tunnel (no router config needed). For example with Cloudflare Tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints a public `https://…trycloudflare.com` URL — share that. (ngrok works too:
`ngrok http 3000`.) These share your app publicly, so only hand the link to people you trust.

## How the sync works

- `server.js` is the **authority**: it holds each room's queue, playback state, chat and
  presence, and broadcasts every change to all connected clients over WebSockets.
- Every server message carries `serverTime`; each client aligns its clock to it (refined by
  ping round-trip), so "play at position X since timestamp T" resolves to the **same moment**
  on every device — that's what keeps playback in sync.
- Playback itself uses the YouTube IFrame player. Some official/VEVO videos disable embedding;
  those can't play in any embedded player and the app auto-skips them.

## Files

- `index.html` — the whole client app (UI + WebSocket client)
- `server.js` — Node HTTP + WebSocket server (static hosting + real-time sync)
- `package.json` — dependencies / scripts
