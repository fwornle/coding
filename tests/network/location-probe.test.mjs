/**
 * lib/network/location-probe.mjs — the N / P facts behind [N:… P:…], shared by
 * the health coordinator and glass. Probes run against injected primitives.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  classifyLocation, observeLocation, networkBadge, countFunctionalFailures, publishedFunctional,
  readProxyEnabledByUser, probePacResolves, probeVpnConnected, FUNCTIONAL_FAIL_THRESHOLD,
} from '../../lib/network/location-probe.mjs';

describe('classifyLocation', () => {
  it('the Cisco CLI is definitive', () => {
    assert.equal(classifyLocation({ vpnConnected: true, pacResolved: false, onPhysicalCN: false }), 'vpn');
  });
  it('PAC resolves fast → corporate, slow → vpn, not at all → open', () => {
    assert.equal(classifyLocation({ vpnConnected: false, pacResolved: true, onPhysicalCN: true }), 'corporate');
    assert.equal(classifyLocation({ vpnConnected: false, pacResolved: true, onPhysicalCN: false }), 'vpn');
    assert.equal(classifyLocation({ vpnConnected: false, pacResolved: false, onPhysicalCN: false }), 'open');
  });
});

describe('observeLocation', () => {
  it('measures latency only when PAC resolves and the CLI said nothing', async () => {
    let latencyAsked = 0;
    const onSite = async () => { latencyAsked++; return true; };
    assert.equal((await observeLocation({ vpn: async () => true, pac: async () => true, onSite })).observed, 'vpn');
    assert.equal((await observeLocation({ vpn: async () => false, pac: async () => false, onSite })).observed, 'open');
    assert.equal(latencyAsked, 0);
    assert.equal((await observeLocation({ vpn: async () => false, pac: async () => true, onSite })).observed, 'corporate');
    assert.equal(latencyAsked, 1);
  });
});

describe('networkBadge', () => {
  it('N labels and the three P states', () => {
    const up = { proxy_running: true, proxy_functional: true };
    assert.equal(networkBadge({ location: 'corporate', ...up, proxy_enabled_by_user: true }).text, 'N:CN P:ON');
    assert.equal(networkBadge({ location: 'open', ...up }).text, 'N:OPEN P:AUTO');
    assert.equal(networkBadge({ location: 'home', ...up }).n, 'OPEN');
    assert.equal(networkBadge({ location: 'vpn', proxy_running: true, proxy_functional: false }).text, 'N:VPN P:OFF');
    assert.equal(networkBadge(null).text, 'N:?? P:OFF');
  });
  it('warns on CN / VPN without a working proxy only', () => {
    assert.equal(networkBadge({ location: 'vpn' }).warn, true);
    assert.equal(networkBadge({ location: 'open' }).warn, false);
    assert.equal(networkBadge({ location: 'corporate', proxy_running: true, proxy_functional: true }).warn, false);
  });
});

describe('functional debounce', () => {
  it('a miss holds the previous value until the threshold confirms it', () => {
    let failures = 0;
    let functional = true;
    for (let i = 1; i <= FUNCTIONAL_FAIL_THRESHOLD; i++) {
      failures = countFunctionalFailures({ raw: false, portListening: true, failures });
      const confirmed = failures >= FUNCTIONAL_FAIL_THRESHOLD;
      functional = publishedFunctional({ raw: false, confirmed, portListening: true, previous: functional });
      assert.equal(functional, i < FUNCTIONAL_FAIL_THRESHOLD, `tick ${i}`);
    }
    assert.equal(countFunctionalFailures({ raw: true, portListening: true, failures }), 0);
  });
  it('a dead port is not debounced, and does not count', () => {
    assert.equal(publishedFunctional({ raw: false, confirmed: false, portListening: false, previous: true }), false);
    assert.equal(countFunctionalFailures({ raw: false, portListening: false, failures: 2 }), 2);
  });
});

describe('probes', () => {
  it('px toggle: an uncommented http_proxy= line in ~/.bash_profile', () => {
    assert.equal(readProxyEnabledByUser({ home: '/h', readFile: () => 'x=1\nhttp_proxy=http://127.0.0.1:3128\n' }), true);
    assert.equal(readProxyEnabledByUser({ home: '/h', readFile: () => '#http_proxy=http://127.0.0.1:3128\n' }), false);
    assert.equal(readProxyEnabledByUser({ home: '/h', readFile: () => { throw new Error('ENOENT'); } }), false);
  });
  it('PAC: dig first; getaddrinfo only when there is no dig', async () => {
    const dig = (out, err) => (file, args, opts, cb) => cb(err || null, out);
    assert.equal(await probePacResolves({ execFile: dig('10.1.2.3\n') }), true);
    assert.equal(await probePacResolves({ execFile: dig('') , lookup: async () => ({ address: '1.1.1.1' }) }), false, 'dig ran: its answer stands');
    assert.equal(await probePacResolves({ host: '', execFile: () => assert.fail('no dig'), lookup: () => assert.fail('no lookup') }), false, 'no corporate host configured: nothing is probed');
    const noDig = Object.assign(new Error('missing'), { code: 'ENOENT' });
    assert.equal(await probePacResolves({ execFile: dig('', noDig), lookup: async () => ({ address: '10.1.2.3' }) }), true);
    assert.equal(await probePacResolves({ execFile: dig('', noDig), lookup: async () => { throw new Error('NXDOMAIN'); } }), false);
  });
  it('VPN CLI: "state: Connected" on stdout; no CLI for the platform → false', async () => {
    const fake = (text) => () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.kill = () => {};
      setImmediate(() => { child.stdout.emit('data', text); child.emit('close', 0); });
      return child;
    };
    assert.equal(await probeVpnConnected({ platform: 'darwin', spawn: fake('>> state: Connected\n'), timeoutMs: 50 }), true);
    assert.equal(await probeVpnConnected({ platform: 'darwin', spawn: fake('>> state: Disconnected\n'), timeoutMs: 50 }), false);
    assert.equal(await probeVpnConnected({ platform: 'aix', spawn: () => assert.fail('no spawn') }), false);
  });
});
