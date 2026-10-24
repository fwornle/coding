// tests/network.test.mjs — the daemon's [N:… P:…] monitor: coding's probes and
// rules, here with injected probes (no dig, curl or VPN CLI on this machine).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createNetworkMonitor } = await import('../lib/glass/network.mjs');
const { networkBadge } = await import('../lib/network/location-probe.mjs');

function monitor(seq) {
  const s = { ...seq };
  return createNetworkMonitor({
    watch: false,
    probes: {
      location: async () => ({ observed: s.location.shift() }),
      port: async () => s.port.shift() ?? true,
      functional: async () => s.functional.shift() ?? true,
      enabled: () => s.enabled ?? false,
      kerberos: async () => s.kerberos ?? null,
      renewTicket: s.renewTicket || (async () => []),
      internet: async () => { s.internetAsked = (s.internetAsked || 0) + 1; return s.internet ?? true; },
      now: s.now,
    },
  });
}

test('facts follow the probes: on-site, proxydetox forwarding, px on → N:CN P:ON', async () => {
  const m = monitor({ location: ['corporate'], port: [true], functional: [true], enabled: true });
  assert.equal(networkBadge(m.facts()).text, 'N:?? P:OFF', 'before the first probe: unknown');
  await m.tick();
  assert.equal(networkBadge(m.facts()).text, 'N:CN P:ON');
  assert.ok(m.facts().last_probe_end);
});

test('one lost PAC lookup does not read as leaving the corporate network (coding\'s hysteresis)', async () => {
  const m = monitor({ location: ['vpn', 'open', 'open', 'open'], port: [], functional: [] });
  await m.tick();
  await m.tick();
  assert.equal(m.facts().location, 'vpn', 'held');
  await m.tick();
  await m.tick();
  assert.equal(m.facts().location, 'open', 'confirmed after three readings');
});

test('one failed forward does not flap P to OFF; a dead port does at once', async () => {
  const m = monitor({ location: ['open', 'open', 'open', 'open', 'open'], port: [true, true, true, true, false], functional: [true, false, false, false] });
  await m.tick();
  await m.tick();
  assert.equal(networkBadge(m.facts()).p, 'AUTO', 'one miss: held');
  await m.tick();
  await m.tick();
  assert.equal(networkBadge(m.facts()).p, 'OFF', 'three misses: confirmed');
  const d = monitor({ location: ['open', 'open'], port: [true, false], functional: [true] });
  await d.tick();
  await d.tick();
  assert.equal(networkBadge(d.facts()).p, 'OFF');
});

test('concurrent ticks share one probe round', async () => {
  let rounds = 0;
  const m = createNetworkMonitor({ watch: false, probes: {
    location: async () => { rounds++; await new Promise((r) => setTimeout(r, 20)); return { observed: 'open' }; },
    port: async () => false, functional: async () => false, enabled: () => false, internet: async () => true,
  } });
  await Promise.all([m.tick(), m.tick(), m.tick()]);
  assert.equal(rounds, 1);
});

test('Kerberos: the monitor publishes the ticket, the badge says K:NO only on CN / VPN', async () => {
  const m = monitor({ location: ['corporate'], port: [true], functional: [true], kerberos: false });
  await m.tick();
  assert.equal(m.facts().kerberos_ticket, false);
  assert.equal(networkBadge(m.facts()).text, 'N:CN P:AUTO K:NO');
});

test('Kerberos: no ticket on CN / VPN asks the SSO extension for one, at most every 2 min', async () => {
  let asked = 0;
  let t = 1_000_000;
  const m = monitor({
    location: ['vpn', 'vpn', 'vpn', 'open'], port: [true, true, true, true], functional: [false, false, false, false],
    kerberos: false, renewTicket: async () => { asked += 1; return ['EXAMPLE.CORP']; }, now: () => t,
  });
  await m.tick();
  assert.equal(asked, 1);
  t += 30_000; await m.tick();
  assert.equal(asked, 1, 'not again within 2 min');
  t += 120_000; await m.tick();
  assert.equal(asked, 2);
});

test('Kerberos: off the corporate network a missing ticket is not chased', async () => {
  let asked = 0;
  const m = monitor({ location: ['open'], port: [true], functional: [true], kerberos: false, renewTicket: async () => { asked += 1; return []; } });
  await m.tick();
  assert.equal(asked, 0);
});

test('no internet off the corporate network → OFFLINE; on CN it is not judged (2026-10-24)', async () => {
  // A wake from sleep left the laptop with no egress at all; proxydetox answered
  // 502 and glass's message pointed at Kerberos, on a home network.
  const seq = { location: ['open'], port: [true], functional: [false], internet: false };
  const m = monitor(seq);
  await m.tick();
  assert.equal(m.facts().internet_reachable, false);
  const b = networkBadge(m.facts());
  assert.equal(b.text, 'N:OPEN P:OFF OFFLINE');
  assert.equal(b.warn, true);
  const cn = { location: ['corporate'], port: [true], functional: [false], internet: false, kerberos: false };
  const c = monitor(cn);
  await c.tick();
  assert.equal(cn.internetAsked, undefined, 'direct egress is blocked on CN by design: not probed');
  assert.equal(networkBadge(c.facts()).text, 'N:CN P:OFF K:NO');
  const up = { location: ['open'], port: [true], functional: [true], internet: false };
  await monitor(up).tick();
  assert.equal(up.internetAsked, undefined, 'a forwarding proxy already proves egress');
});

test('egress: a refused tunnel names the proxy and the host, and is not asked again for 10 s', async () => {
  const http = await import('node:http');
  const { createEgressFetch, TUNNEL_REFUSAL_MEMORY_MS } = await import('../lib/glass/egress.mjs');
  let connects = 0;
  const px = http.createServer();
  px.on('connect', (req, sock) => { connects++; sock.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); });
  await new Promise((r) => px.listen(0, '127.0.0.1', r));
  const proxy = `http://127.0.0.1:${px.address().port}`;
  let clock = 1_000_000;
  const seen = [];
  const f = createEgressFetch({ HTTPS_PROXY: proxy }, 12445, { now: () => clock, onRefusal: (r) => seen.push(r) });
  try {
    await assert.rejects(f('https://api.example.com/v1'), (e) => e.code === 'GLASS_TUNNEL_REFUSED'
      && e.message.includes(proxy) && e.message.includes('api.example.com') && e.message.includes('HTTP 502') && e.message.includes('internet') && e.message.includes('klist'));
    assert.deepEqual(seen.map((r) => [r.host, r.status]), [['api.example.com', 502]]);
    await assert.rejects(f('https://api.example.com/v1'), (e) => e.code === 'GLASS_TUNNEL_REFUSED');
    assert.equal(connects, 1, 'the retry inside the window does not wait on the proxy again');
    clock += TUNNEL_REFUSAL_MEMORY_MS;
    await assert.rejects(f('https://api.example.com/v1'), (e) => e.code === 'GLASS_TUNNEL_REFUSED');
    assert.equal(connects, 2, 'after the window the proxy is asked again');
  } finally {
    px.close();
  }
});
