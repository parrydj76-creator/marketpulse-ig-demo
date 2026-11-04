'use strict';

// Read-only IG DEMO market metadata inspection.
// No dealing requests, order placement or execution.
const HOST = 'https://demo-api.ig.com/gateway/deal';
const EPIC = 'CS.D.EURUSD.CFD.IP';

async function main() {
  for (const key of ['IG_API_KEY', 'IG_USERNAME', 'IG_PASSWORD']) {
    if (!process.env[key]) throw Error(`Missing ${key}`);
  }

  const session = await fetch(`${HOST}/session`, {
    method: 'POST',
    headers: {
      'X-IG-API-KEY': process.env.IG_API_KEY,
      VERSION: '2',
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      identifier: process.env.IG_USERNAME,
      password: process.env.IG_PASSWORD
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!session.ok) throw Error(`IG login HTTP ${session.status}`);

  const cst = session.headers.get('cst');
  const xst = session.headers.get('x-security-token');
  if (!cst || !xst) throw Error('Missing IG session tokens');

  const response = await fetch(
    `${HOST}/markets/${encodeURIComponent(EPIC)}`,
    {
      headers: {
        'X-IG-API-KEY': process.env.IG_API_KEY,
        CST: cst,
        'X-SECURITY-TOKEN': xst,
        VERSION: '3',
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(15000)
    }
  );

  if (!response.ok) throw Error(`Market lookup HTTP ${response.status}`);

  const data = await response.json();
  const i = data.instrument || {};
  const r = data.dealingRules || {};

  console.log(JSON.stringify({
    epic: i.epic,
    type: i.type,
    unit: i.unit,
    lotSize: i.lotSize,
    contractSize: i.contractSize,
    valueOfOnePip: i.valueOfOnePip,
    onePipMeans: i.onePipMeans,
    currencies: i.currencies,
    minimumDealSize: r.minDealSize,
    minimumStopDistance: r.minNormalStopOrLimitDistance,
    minimumControlledStopDistance: r.minControlledRiskStopDistance,
    guaranteedStopAllowed: i.controlledRiskAllowed,
    guaranteedStopPremium: r.controlledRiskSpacing,
    decimalPlacesFactor: data.snapshot?.decimalPlacesFactor,
    scalingFactor: data.snapshot?.scalingFactor,
    snapshot: data.snapshot,
    dealingRules: data.dealingRules,
    marginDepositBands: i.marginDepositBands
  }, null, 2));
}

main().catch(e => {
  console.error('Verification failed:', e.message);
  process.exitCode = 1;
});
