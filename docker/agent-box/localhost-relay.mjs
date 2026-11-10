#!/usr/bin/env node
/**
 * coding agent box — localhost for the host's web UIs.
 *
 * The UIs are built for http://localhost:<port>: the dashboard frontend calls
 * its API at a fixed http://localhost:3033, the viewer at localhost:12436. In
 * the box, localhost is the box itself, so a browser there would load the page
 * from the gate and then fail every API call. This listens on the box's own
 * loopback for each of those ports and pipes the bytes to the same port on
 * host.docker.internal — the gate, whose view relay is where the rules are
 * (GET/HEAD/OPTIONS only, no WebSocket, no cookies). Nothing is checked here,
 * so nothing here needs trusting: an agent that replaced this relay would
 * still reach only the gate.
 *
 * Started by the entrypoint as `nobody`, before the agent, and only when the
 * launcher passes CODING_BOX_HOST_VIEW (not in --strict-box).
 *
 *   node localhost-relay.mjs 3032,3033,12436 [target-host]
 */

import net from 'node:net';
import process from 'node:process';

/** "3032,3033" → [3032, 3033]; anything malformed is dropped. */
export function parsePorts(s) {
  return [...new Set(String(s || '').split(',').map((p) => Number(p.trim())))]
    .filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
}

/** Listen on `host`:`port` and pipe each connection to `target`:`port`. Resolves the server, or null if the address is taken. */
export function relay(port, { host = '127.0.0.1', target = 'host.docker.internal' } = {}) {
  return new Promise((resolve) => {
    const srv = net.createServer((client) => {
      const up = net.connect(port, target);
      client.on('error', () => up.destroy());
      up.on('error', () => client.destroy());
      client.pipe(up);
      up.pipe(client);
    });
    srv.once('error', () => resolve(null));
    srv.listen(port, host, () => resolve(srv));
  });
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const ports = parsePorts(process.argv[2]);
  const target = process.argv[3] || 'host.docker.internal';
  const up = [];
  for (const port of ports) {
    // Both loopbacks: a browser resolves localhost to ::1 as well as 127.0.0.1.
    const v4 = await relay(port, { host: '127.0.0.1', target });
    await relay(port, { host: '::1', target });
    if (v4) up.push(port);
  }
  process.stdout.write(`${JSON.stringify({ relay: up, target })}\n`);
}
