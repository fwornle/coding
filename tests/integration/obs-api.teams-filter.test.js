/**
 * T6: `?teams=` on obs-api's read routes — server-side, before pagination.
 *
 * Team ids that are not declared teams are project ids (the viewer's "views"),
 * so these fixtures need no teams config: `?teams=proj-a` keeps proj-a.
 */

import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.OBSERVATIONS_API_NO_AUTOSTART = '1';

describe('obs-api ?teams= filter', () => {
  let dataDir;
  let kmStore;
  let server;
  let baseUrl;

  beforeAll(async () => {
    const { GraphKMStore, defaultOntologyDir } = await import('@fwornle/km-core');
    dataDir = mkdtempSync(path.join(tmpdir(), 'obs-api-teams-'));
    mkdirSync(path.join(dataDir, 'leveldb'), { recursive: true });
    kmStore = new GraphKMStore({
      dbPath: path.join(dataDir, 'leveldb'),
      exportDir: path.join(dataDir, 'exports'),
      ontologyDir: defaultOntologyDir(),
    });
    await kmStore.open();
    const put = (name, metadata) => kmStore.putEntity(
      { name, entityType: 'Insight', ontologyClass: 'Insight', description: name, metadata: { topic: name, ...metadata } },
      { skipOntologyCheck: true },
    );
    await put('insight-a1', { project: 'proj-a' });
    await put('insight-a2', { team: 'Proj-A' }); // legacy team stamp, other case
    await put('insight-b', { project: 'proj-b' });
    await put('insight-none', {});

    const obsApi = await import('../../scripts/observations-api-server.mjs');
    obsApi._testHooks.setKMStoreForTest(kmStore);
    obsApi._testHooks.mountV1RoutesForTest();
    server = await new Promise((resolve, reject) => {
      const s = obsApi._testHooks.app.listen(0, '127.0.0.1', () => resolve(s));
      s.on('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }, 60_000);

  afterAll(async () => {
    try { if (server) await new Promise((r) => server.close(() => r())); } catch { /* best-effort */ }
    try { if (kmStore) await kmStore.close(); } catch { /* best-effort */ }
    try { if (dataDir) rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  const names = async (url, pick) => {
    const res = await fetch(`${baseUrl}${url}`);
    expect(res.status).toBe(200);
    return pick(await res.json()).sort();
  };

  test('/api/v1/entities?teams= keeps only that project (legacy team stamp included)', async () => {
    const all = await names('/api/v1/entities', (b) => b.data.map((e) => e.name));
    expect(all).toEqual(['insight-a1', 'insight-a2', 'insight-b', 'insight-none']);
    expect(await names('/api/v1/entities?teams=proj-a', (b) => b.data.map((e) => e.name)))
      .toEqual(['insight-a1', 'insight-a2']);
    expect(await names('/api/v1/entities?teams=proj-a,proj-b&limit=2', (b) => b.data.map((e) => e.name)))
      .toHaveLength(2);
  });

  test('/api/coding/insights?teams= filters before pagination', async () => {
    const topics = (b) => (b.data ?? b.insights ?? b.items ?? []).map((r) => r.topic);
    expect(await names('/api/coding/insights?teams=proj-b', topics)).toEqual(['insight-b']);
    expect(await names('/api/coding/insights?teams=nobody', topics)).toEqual([]);
  });
});
