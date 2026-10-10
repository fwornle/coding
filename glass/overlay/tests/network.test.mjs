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
    port: async () => false, functional: async () => false, enabled: () => false,
  } });
  await Promise.all([m.tick(), m.tick(), m.tick()]);
  assert.equal(rounds, 1);
});
