/**
 * Good Buddy Audio Relay Server
 *
 * Simple WebSocket relay for push-to-talk audio.
 * Each connected client sends their location + call sign on connect.
 * When a client sends an audio chunk, the server finds all clients
 * within the sender's range and relays the chunk to them.
 *
 * Deploy to Railway, Render, or Fly.io (free tiers work).
 * Run: node server.js
 * Default port: 8080 (set PORT env var to override)
 */

const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

// Client state
const clients = new Map(); // ws -> { callSign, lat, lng, range }

// Haversine distance in miles
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const wss = new WebSocketServer({ port: PORT });

console.log(`Good Buddy relay running on port ${PORT}`);
console.log(`Clients connected: 0`);

wss.on('connection', (ws) => {
  console.log(`New connection (total: ${wss.clients.size})`);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return; // ignore malformed messages
    }

    switch (msg.type) {
      case 'join': {
        // Client registers with location
        clients.set(ws, {
          callSign: msg.callSign || 'Unknown',
          lat: msg.lat,
          lng: msg.lng,
          range: msg.range || 10, // miles
        });
        console.log(`${msg.callSign} joined at ${msg.lat}, ${msg.lng} (range: ${msg.range}mi)`);

        // Broadcast join to nearby users
        broadcastNearby(ws, {
          type: 'joined',
          callSign: msg.callSign,
        });
        break;
      }

      case 'update': {
        // Client updates location/range
        const client = clients.get(ws);
        if (client) {
          client.lat = msg.lat;
          client.lng = msg.lng;
          client.range = msg.range || client.range;
        }
        break;
      }

      case 'audio': {
        // Relay audio chunk to all clients in sender's range
        const sender = clients.get(ws);
        if (!sender) return;

        const chunk = msg.data; // base64-encoded audio
        // TEMP instrumentation for diagnosing perceived PTT delay --
        // real server-side receive timestamp, sent back to every relayed
        // client so the receiving app can compute true end-to-end network
        // + relay time, not just infer it from client-only logs.
        const serverReceivedAt = Date.now();
        let relayed = 0;

        wss.clients.forEach((clientWs) => {
          if (clientWs === ws || clientWs.readyState !== 1) return;

          const target = clients.get(clientWs);
          if (!target) return;

          const dist = haversineMiles(
            sender.lat, sender.lng,
            target.lat, target.lng
          );

          if (dist <= sender.range) {
            clientWs.send(JSON.stringify({
              type: 'audio',
              callSign: sender.callSign,
              data: chunk,
              serverReceivedAt,
              serverRelayedAt: Date.now(),
            }));
            relayed++;
          }
        });

        if (relayed > 0) {
          console.log(`${sender.callSign} → ${relayed} listener(s)`);
        }
        break;
      }

      case 'ptt_start': {
        // Notify nearby that someone keyed up
        const sender = clients.get(ws);
        if (!sender) return;
        broadcastNearby(ws, {
          type: 'ptt_start',
          callSign: sender.callSign,
        });
        break;
      }

      case 'ptt_end': {
        const sender = clients.get(ws);
        if (!sender) return;
        broadcastNearby(ws, {
          type: 'ptt_end',
          callSign: sender.callSign,
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client) {
      console.log(`${client.callSign} disconnected`);
      broadcastNearby(ws, {
        type: 'left',
        callSign: client.callSign,
      });
    }
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

// Broadcast a message to all clients within range of the sender
function broadcastNearby(senderWs, msg) {
  const sender = clients.get(senderWs);
  if (!sender) return;

  wss.clients.forEach((clientWs) => {
    if (clientWs === senderWs || clientWs.readyState !== 1) return;

    const target = clients.get(clientWs);
    if (!target) return;

    const dist = haversineMiles(
      sender.lat, sender.lng,
      target.lat, target.lng
    );

    if (dist <= sender.range) {
      clientWs.send(JSON.stringify(msg));
    }
  });
}

// Health check
setInterval(() => {
  console.log(`Clients: ${wss.clients.size}`);
}, 60000);
