/**
 * lib/network/location-probe.mjs — the N / P facts behind [N:… P:…], shared by
 * the health coordinator and glass. Probes run against injected primitives.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  classifyLocation, observeLocation, networkBadge, countFunctionalFailures, publishedFunctional,
  readProxyEnabledByUser, probePacResolves, probeProxyFunctional, probeKerberosTicket, requestKerberosTicket, networkProbeIntervalMs, probeVpnConnected, isWsl, FUNCTIONAL_FAIL_THRESHOLD, PROXY_PROBE_HOST,
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
  it('K:NO on CN / VPN without a Kerberos ticket — the proxy cannot authenticate', () => {
    const up = { proxy_running: true, proxy_functional: true };
    const b = networkBadge({ location: 'corporate', ...up, kerberos_ticket: false });
    assert.equal(b.text, 'N:CN P:AUTO K:NO');
    assert.equal(b.warn, true);
    assert.equal(networkBadge({ location: 'vpn', ...up, kerberos_ticket: true }).text, 'N:VPN P:AUTO');
    assert.equal(networkBadge({ location: 'vpn', ...up, kerberos_ticket: null }).text, 'N:VPN P:AUTO', 'unknown is not shown');
    assert.equal(networkBadge({ location: 'open', ...up, kerberos_ticket: false }).text, 'N:OPEN P:AUTO', 'off the corporate network it does not matter');
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
  it('proxy functional: a CONNECT tunnel to a host the proxy must carry, nothing sent through it', async () => {
    const net = await import('node:net');
    const answer = (statusLine) => {
      const seen = [];
      const srv = net.createServer((c) => c.once('data', (d) => { seen.push(String(d).split('\r\n')[0]); c.end(statusLine ? `${statusLine}\r\n\r\n` : ''); }));
      return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, seen, port: srv.address().port })));
    };
    assert.equal(PROXY_PROBE_HOST, 'api.github.com', 'not captive.apple.com: on CN that passes while every tunnel is refused');
    for (const [line, ok] of [['HTTP/1.1 200 Connection established', true], ['HTTP/1.1 502 Bad Gateway', false],
      ['HTTP/1.1 407 Proxy Authentication Required', false], [null, false]]) {
      const { srv, seen, port } = await answer(line);
      assert.equal(await probeProxyFunctional({ port }), ok, String(line));
      assert.deepEqual(seen, ['CONNECT api.github.com:443 HTTP/1.1']);
      srv.close();
    }
    assert.equal(await probeProxyFunctional({ port: 1, timeoutMs: 500 }), false, 'nothing listening');
  });
  it('Kerberos: klist -s exit 0 = ticket; non-zero = none; no klist / Windows = unknown', async () => {
    const klist = (err) => (file, args, opts, cb) => { assert.deepEqual([file, args], ['klist', ['-s']]); cb(err); };
    assert.equal(await probeKerberosTicket({ execFile: klist(null), platform: 'darwin' }), true);
    assert.equal(await probeKerberosTicket({ execFile: klist(Object.assign(new Error('exit 1'), { code: 1 })), platform: 'darwin' }), false);
    assert.equal(await probeKerberosTicket({ execFile: klist(Object.assign(new Error('missing'), { code: 'ENOENT' })), platform: 'linux' }), null);
    assert.equal(await probeKerberosTicket({ execFile: () => assert.fail('not run'), platform: 'win32' }), null);
  });
  it('console probes start hidden: no window flashes from the console-less daemon on Windows', async () => {
    const seen = [];
    const spy = (out) => (file, args, opts, cb) => { seen.push([file, opts.windowsHide]); cb(null, out); };
    await probePacResolves({ execFile: spy('10.1.2.3\n') });
    assert.deepEqual(seen, [['dig', true]]);
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
  it('VPN CLI on WSL: the Windows host\'s client, through interop', async () => {
    const seen = [];
    const spy = (bin) => { seen.push(bin); const c = new EventEmitter(); c.stdout = new EventEmitter(); c.kill = () => {}; setImmediate(() => c.emit('close', 0)); return c; };
    await probeVpnConnected({ platform: 'linux', wsl: true, spawn: spy, timeoutMs: 50 });
    await probeVpnConnected({ platform: 'linux', wsl: false, spawn: spy, timeoutMs: 50 });
    assert.deepEqual(seen, ['/mnt/c/Program Files (x86)/Cisco/Cisco Secure Client/vpncli.exe', '/opt/cisco/secureclient/bin/vpn']);
    assert.equal(isWsl({ platform: 'linux', release: '5.15.167.4-microsoft-standard-WSL2', env: {} }), true);
    assert.equal(isWsl({ platform: 'linux', release: '6.8.0-45-generic', env: { WSL_DISTRO_NAME: 'Ubuntu' } }), true);
    assert.equal(isWsl({ platform: 'linux', release: '6.8.0-45-generic', env: {} }), false);
    assert.equal(isWsl({ platform: 'darwin', release: '25.6.0', env: { WSL_DISTRO_NAME: 'x' } }), false);
  });
});

describe('requestKerberosTicket — asks the SSO extension, never waits for it', () => {
  const fake = (listOut, listErr = null) => {
    const calls = [];
    const fn = (cmd, args, opts, cb) => {
      calls.push([cmd, ...args]);
      if (args[0] === '-l') return cb(listErr, listOut);
      // the refresh itself: never call back, as a 12s request would not yet have
    };
    fn.calls = calls;
    return fn;
  };

  it('requests a refresh for every configured realm and resolves without waiting', async () => {
    const ex = fake('[\n  "EUROPE.EXAMPLE.CORP"\n]');
    assert.deepEqual(await requestKerberosTicket({ execFile: ex, platform: 'darwin' }), ['EUROPE.EXAMPLE.CORP']);
    assert.deepEqual(ex.calls[1], ['app-sso', '-a', 'EUROPE.EXAMPLE.CORP', '-R', '-q']);
  });

  it('does nothing where there is no extension or no realm', async () => {
    assert.deepEqual(await requestKerberosTicket({ execFile: fake('', new Error('ENOENT')), platform: 'darwin' }), []);
    assert.deepEqual(await requestKerberosTicket({ execFile: fake('[]'), platform: 'darwin' }), []);
    assert.deepEqual(await requestKerberosTicket({ execFile: fake('not json'), platform: 'darwin' }), []);
  });

  it('is macOS only', async () => {
    const ex = fake('["R"]');
    assert.deepEqual(await requestKerberosTicket({ execFile: ex, platform: 'linux' }), []);
    assert.equal(ex.calls.length, 0);
  });
});

describe('networkProbeIntervalMs — faster only while the corporate path is broken', () => {
  it('15 s when everything works, wherever you are', () => {
    assert.equal(networkProbeIntervalMs({ location: 'vpn', proxy_functional: true, kerberos_ticket: true }), 15_000);
    assert.equal(networkProbeIntervalMs({ location: 'open', proxy_functional: true }), 15_000);
  });
  it('5 s on CN / VPN while the local proxy does not forward', () => {
    assert.equal(networkProbeIntervalMs({ location: 'vpn', proxy_functional: false, kerberos_ticket: true }), 5_000);
    assert.equal(networkProbeIntervalMs({ location: 'corporate', proxy_functional: false }), 5_000);
  });
  it('5 s on CN / VPN while the Kerberos ticket is missing', () => {
    assert.equal(networkProbeIntervalMs({ location: 'vpn', proxy_functional: true, kerberos_ticket: false }), 5_000);
  });
  it('off the corporate network a broken local proxy is no reason to hurry', () => {
    assert.equal(networkProbeIntervalMs({ location: 'open', proxy_functional: false, kerberos_ticket: false }), 15_000);
    assert.equal(networkProbeIntervalMs({}), 15_000);
  });
});
