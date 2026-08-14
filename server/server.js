/**
 * Good Buddy Audio Relay Server
 *
 * Simple WebSocket relay for push-to-talk audio.
 * Each connected client sends their location + call sign on connect.
 * When a client sends an audio chunk, the server finds all clients
 * within the sender's range and relays the chunk to them.
 *
 * Also handles real background push notifications: when a transmission
 * happens, any NEARBY user who is currently discoverable/opted-in but
 * NOT live-connected via WebSocket right now (backgrounded/closed app)
 * gets a real Expo push notification instead of silently missing the
 * transmission. Live-connected recipients already get the audio
 * directly -- pushing them too would be redundant/annoying.
 *
 * Deploy to Railway, Render, or Fly.io (free tiers work).
 * Run: node server.js
 * Default port: 8080 (set PORT env var to override)
 */

const { WebSocketServer } = require('ws');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 8080;

// Real design decision: uses the SAME anon key the client app already
// ships with (EXPO_PUBLIC_SUPABASE_ANON_KEY) -- deliberately NOT the
// service_role secret. get_push_tokens_for_users (see
// supabase/migrations/002_push_tokens.sql) is a SECURITY DEFINER RPC
// that's the one sanctioned path for this server to read push_token
// values despite RLS blocking that column on a plain SELECT with the
// anon key. No new secret to provision/rotate for this server.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.warn('SUPABASE_URL/SUPABASE_ANON_KEY not set -- background push notifications disabled');
}

// Client state
const clients = new Map(); // ws -> { userId, callSign, lat, lng, range }

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

// Real, exact Expo push API -- confirmed via docs.expo.dev, no auth
// required for basic sends, plain JSON POST. Fire-and-forget by
// design: a failed/slow push must never block or delay the live
// audio relay path above it. Errors are logged, not retried -- a
// missed background alert is a real but non-critical degradation,
// unlike a dropped live audio chunk.
async function sendPushNotification(pushToken, senderCallSign) {
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify({
        to: pushToken,
        title: 'Good Buddy',
        body: `${senderCallSign} is transmitting nearby`,
        channelId: 'nearby-transmissions',
        priority: 'high',
      }),
    });
    if (!res.ok) {
      console.error(`Push send failed (${res.status}) for token ${pushToken.slice(0, 20)}...`);
    }
  } catch (e) {
    console.error('Push send error:', e.message);
  }
}

// For a sender's transmission, find nearby users who are OPTED IN to
// push (push_enabled + a token on file) but NOT currently among the
// live WebSocket recipients that just got the real audio -- those
// users are backgrounded/app-closed, exactly the case this feature
// targets. connectedUserIds is the set that already got the live
// relay (see the 'audio' case below) -- deliberately excluded here so
// a foregrounded user never gets both the live audio AND a redundant
// push.
async function notifyBackgroundedNearbyUsers(sender, connectedUserIds) {
  if (!supabase) return;

  try {
    // Real RPC call (find_nearby_users), same one the client itself
    // uses for its "GOOD BUDDIES IN RANGE" count -- reuses the exact
    // same geospatial logic rather than re-deriving it here, so
    // "nearby" means the same thing for push as it does for live
    // relay/discovery.
    const { data: nearby, error } = await supabase.rpc('find_nearby_users', {
      p_lat: sender.lat,
      p_lng: sender.lng,
      p_range_miles: sender.range,
      p_exclude_id: sender.userId,
    });
    if (error) {
      console.error('find_nearby_users (push path) failed:', error.message);
      return;
    }

    const backgroundedIds = (nearby || [])
      .map((u) => u.id)
      .filter((id) => !connectedUserIds.has(id));
    if (backgroundedIds.length === 0) return;

    const { data: tokenRows, error: tokenError } = await supabase.rpc('get_push_tokens_for_users', {
      p_user_ids: backgroundedIds,
    });
    if (tokenError) {
      console.error('get_push_tokens_for_users failed:', tokenError.message);
      return;
    }

    for (const row of tokenRows || []) {
      sendPushNotification(row.push_token, sender.callSign);
    }
    if ((tokenRows || []).length > 0) {
      console.log(`${sender.callSign} → ${tokenRows.length} background push(es)`);
    }
  } catch (e) {
    console.error('notifyBackgroundedNearbyUsers error:', e.message);
  }
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
        // Real hardening added after a live "hearing myself" bug: a
        // client-side duplicate-connection race (multiple WebSocket
        // instances all registering under the same call sign, root
        // cause was a stale reconnect-timer closure surviving a
        // superseded connect() call -- see usePTT.ts's
        // connectionGenerationRef comment for the full story) meant
        // this server was relaying a sender's own audio back to their
        // OTHER stale connections, which are trivially "in range" of
        // themselves. The client-side fix prevents new duplicates from
        // forming, but this server-side guard is real defense in depth:
        // if a call sign re-joins while an older connection under that
        // same call sign is still open, close the older one explicitly
        // instead of ever letting two live connections share an
        // identity.
        for (const [existingWs, existingClient] of clients) {
          if (existingWs !== ws && existingClient.callSign === msg.callSign) {
            console.log(`${msg.callSign} re-joined -- closing a stale duplicate connection`);
            existingWs.close();
            clients.delete(existingWs);
          }
        }

        // Client registers with location
        clients.set(ws, {
          userId: msg.userId || null,
          callSign: msg.callSign || 'Unknown',
          lat: msg.lat,
          lng: msg.lng,
          range: msg.range || 2500, // miles
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
        // Real userIds who got the LIVE audio via WebSocket this round
        // -- passed to notifyBackgroundedNearbyUsers below so it never
        // also pushes a redundant notification to someone who's
        // foregrounded and already hearing this transmission directly.
        const connectedUserIds = new Set();

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
              // Real fix accompanying the Android moov-atom-corruption
              // fix (see usePTT.ts VOICE_RECORDING_OPTIONS comment):
              // Android and iOS now record in genuinely different
              // container formats (.3gp/AMR-NB vs .m4a/AAC), so the
              // relay must forward which format the sender used --
              // without this, the receiving client can't build a
              // correctly-typed playback data URI.
              format: msg.format,
              serverReceivedAt,
              serverRelayedAt: Date.now(),
            }));
            relayed++;
            if (target.userId) connectedUserIds.add(target.userId);
          }
        });

        if (relayed > 0) {
          console.log(`${sender.callSign} → ${relayed} listener(s)`);
        }

        // Real background push path -- fire-and-forget, never awaited
        // here so a slow Supabase/Expo round-trip can't delay the next
        // audio chunk this connection sends. Gated on sender.userId
        // existing at all (older/dev-tethered clients that predate the
        // userId-in-join change simply won't trigger this -- degrades
        // gracefully rather than erroring).
        if (sender.userId) {
          notifyBackgroundedNearbyUsers(sender, connectedUserIds);
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
