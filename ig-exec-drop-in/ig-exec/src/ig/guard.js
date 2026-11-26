'use strict';
// Layer 1 of live-account protection: only the IG DEMO host may ever be contacted.
const DEMO_HOST = 'demo-api.ig.com';

function assertDemoUrl(url) {
  const host = new URL(url).hostname;
  const testOk = process.env.NODE_ENV === 'test' && host === '127.0.0.1';
  if (host !== DEMO_HOST && !testOk) {
    throw new Error(`LIVE-ACCOUNT GUARD: refusing to contact ${host}. Only ${DEMO_HOST} is permitted.`);
  }
}

function assertDemoConfig(env = process.env) {
  if (env.IG_ENV && env.IG_ENV.toUpperCase() !== 'DEMO') throw new Error('LIVE-ACCOUNT GUARD: IG_ENV must be DEMO');
  if (!env.IG_DEMO_ACCOUNT_ID) throw new Error('LIVE-ACCOUNT GUARD: IG_DEMO_ACCOUNT_ID is required');
  assertDemoUrl(env.IG_BASE_URL || `https://${DEMO_HOST}/gateway/deal`);
}
module.exports = { assertDemoUrl, assertDemoConfig, DEMO_HOST };
