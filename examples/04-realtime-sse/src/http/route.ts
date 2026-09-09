import { controller, route } from 'exisjs/router'

export default controller({
  index: route.get('/', {
    handle: async ({ res }) => {
      res.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ExisJS Realtime SSE Demo</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 800px; margin: 0 auto; }
    h1 { color: #a855f7; display: flex; align-items: center; gap: 0.5rem; }
    .badge { background: #22c55e; color: #000; font-size: 0.75rem; padding: 2px 8px; border-radius: 9999px; font-weight: bold; }
    #feed { background: #1e293b; border-radius: 8px; padding: 1rem; height: 350px; overflow-y: auto; font-family: monospace; border: 1px solid #334155; }
    .event { margin-bottom: 0.5rem; padding: 0.5rem; background: #0f172a; border-left: 3px solid #a855f7; border-radius: 4px; }
    .event.system { border-left-color: #3b82f6; }
    .event.alert { border-left-color: #ef4444; }
    button { background: #a855f7; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 1rem; }
    button:hover { background: #9333ea; }
  </style>
</head>
<body>
  <h1>⚡ ExisJS Live SSE Stream <span class="badge">LIVE</span></h1>
  <p>Real-time Server-Sent Events stream powered by ExisJS hardware-accelerated pipeline.</p>
  
  <div id="feed">
    <div class="event system">Connecting to /events/live ...</div>
  </div>

  <button onclick="triggerBroadcast()">Send Broadcast</button>

  <script>
    const feed = document.getElementById('feed');
    const es = new EventSource('/events/live');

    es.addEventListener('connected', (e) => {
      const data = JSON.parse(e.data);
      appendEvent('Connected to ExisJS SSE stream! Client ID: ' + data.clientId, 'system');
    });

    es.addEventListener('ticker', (e) => {
      const data = JSON.parse(e.data);
      appendEvent('TICK: CPU ' + data.cpu + '% · Memory ' + data.memory + 'MB · Latency ' + data.latency + 'ms');
    });

    es.addEventListener('broadcast', (e) => {
      const data = JSON.parse(e.data);
      appendEvent('BROADCAST: ' + data.message, 'alert');
    });

    function appendEvent(text, type = '') {
      const div = document.createElement('div');
      div.className = 'event ' + type;
      div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + text;
      feed.appendChild(div);
      feed.scrollTop = feed.scrollHeight;
    }

    async function triggerBroadcast() {
      await fetch('/events/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Manual broadcast event at ' + Date.now() })
      });
    }
  </script>
</body>
</html>`)
    }
  })
})
