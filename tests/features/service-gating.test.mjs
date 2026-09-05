/**
 * Feature gating of the launch-time host services.
 *
 * The structural assertions matter as much as the behavioural ones: the whole
 * reason SERVICE_ORDER exists is that ten hand-written start blocks were ten
 * chances to forget a gate. These tests fail if a service is added without a
 * feature, or added to the configs but never started.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  startOneService, SERVICE_CONFIGS, SERVICE_ORDER,
} from '../../scripts/start-services-robust.js';

const require = createRequire(import.meta.url);
const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;
const { FEATURE_IDS } = require(join(REPO, 'lib/features/catalogue.cjs'));

/** A resolved-features object shaped like loadFeatures() output. */
function featureSet(overrides = {}) {
  const features = {};
  for (const id of FEATURE_IDS) {
    const enabled = overrides[id] ?? true;
    features[id] = {
      enabled,
      reason: enabled ? 'on — test' : 'off — test',
      source: 'test',
    };
  }
  return { features, enabled: FEATURE_IDS.filter((id) => features[id].enabled), disabled: [], warnings: [] };
}

function emptyResults() {
  return { successful: [], degraded: [], failed: [], disabled: [] };
}

describe('service catalogue coverage', () => {
  test('every service declares a feature', () => {
    const missing = Object.entries(SERVICE_CONFIGS)
      .filter(([, cfg]) => !cfg.feature)
      .map(([key]) => key);
    assert.deepEqual(missing, [], 'services without a feature will never be gated');
  });

  test('every declared feature is a real one', () => {
    for (const [key, cfg] of Object.entries(SERVICE_CONFIGS)) {
      assert.ok(FEATURE_IDS.includes(cfg.feature), `${key} names unknown feature '${cfg.feature}'`);
    }
  });

  test('SERVICE_ORDER and SERVICE_CONFIGS cover each other exactly', () => {
    const ordered = SERVICE_ORDER.map((o) => o.key).sort();
    const configured = Object.keys(SERVICE_CONFIGS).sort();
    assert.deepEqual(ordered, configured);
  });

  test('the live-logging pair still starts before everything else', () => {
    // Order is load-bearing: the transcript monitor and its coordinator are what
    // later services register against.
    assert.deepEqual(
      SERVICE_ORDER.slice(0, 2).map((o) => o.key),
      ['transcriptMonitor', 'liveLoggingCoordinator'],
    );
  });
});

describe('gating', () => {
  test('a disabled feature skips the service without starting it', async () => {
    const results = emptyResults();
    let started = false;
    const original = SERVICE_CONFIGS.observationsApi.startFn;
    SERVICE_CONFIGS.observationsApi.startFn = async () => { started = true; return {}; };
    try {
      const out = await startOneService('observationsApi', results, featureSet({ observations: false }));
      assert.equal(started, false, 'startFn must not run for a disabled feature');
      assert.equal(out.blocked, false);
      assert.equal(results.disabled.length, 1);
      assert.equal(results.disabled[0].feature, 'observations');
      assert.equal(results.successful.length + results.degraded.length + results.failed.length, 0);
    } finally {
      SERVICE_CONFIGS.observationsApi.startFn = original;
    }
  });

  test('a disabled service is not reported as degraded', async () => {
    // Degraded means "we wanted this and could not have it". Conflating the two
    // is how a pared-down install ends up looking broken.
    const results = emptyResults();
    await startOneService('llmCliProxy', results, featureSet({ 'llm-proxy': false }));
    assert.equal(results.degraded.length, 0);
    assert.equal(results.disabled.length, 1);
  });

  test('a REQUIRED service whose feature is off does not block startup', async () => {
    const results = emptyResults();
    const out = await startOneService('vkbServer', results, featureSet({ knowledge: false }));
    assert.equal(SERVICE_CONFIGS.vkbServer.required, true, 'precondition: vkbServer is required');
    assert.equal(out.blocked, false, 'required-ness applies only when the feature is on');
    assert.equal(results.failed.length, 0);
  });

  test('a required failure blocks, so downstream services do not start', async () => {
    const results = emptyResults();
    const original = SERVICE_CONFIGS.vkbServer.startFn;
    const originalRetries = SERVICE_CONFIGS.vkbServer.maxRetries;
    SERVICE_CONFIGS.vkbServer.startFn = async () => { throw new Error('boom'); };
    // One attempt: this asserts the blocking contract, not the backoff schedule,
    // and the real value costs six seconds of exponential waiting.
    SERVICE_CONFIGS.vkbServer.maxRetries = 1;
    try {
      const out = await startOneService('vkbServer', results, featureSet());
      assert.equal(out.blocked, true);
      assert.equal(results.failed.length, 1);
      assert.equal(results.failed[0].required, true);
      assert.match(results.failed[0].error, /boom/);
    } finally {
      SERVICE_CONFIGS.vkbServer.startFn = original;
      SERVICE_CONFIGS.vkbServer.maxRetries = originalRetries;
    }
  });

  test('an unknown feature on a config is a loud failure, not a silent skip', async () => {
    const results = emptyResults();
    const original = SERVICE_CONFIGS.observationsApi.feature;
    SERVICE_CONFIGS.observationsApi.feature = 'nope';
    try {
      await assert.rejects(
        () => startOneService('observationsApi', results, featureSet()),
        /unknown feature 'nope'/,
      );
    } finally {
      SERVICE_CONFIGS.observationsApi.feature = original;
    }
  });
});
