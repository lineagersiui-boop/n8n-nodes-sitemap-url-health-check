'use strict';
// Loads the compiled node and credential from dist/ and runs execute() against a fake Apify API.
// Run after `npm run build`: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const pkg = require('../package.json');
const { SitemapUrlHealthCheck, evaluateResults, parseFlagList } = require('../dist/nodes/SitemapUrlHealthCheck/SitemapUrlHealthCheck.node.js');
const { ApifySitemapHealthApi } = require('../dist/credentials/ApifySitemapHealthApi.credentials.js');

const items = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-items.json'), 'utf8'));
const summary = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-summary.json'), 'utf8'));

test('package.json n8n section points at existing dist files', () => {
  assert.ok(pkg.keywords.includes('n8n-community-node-package'));
  assert.ok(pkg.name.startsWith('n8n-nodes-'));
  assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
  for (const f of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
});

test('node and credential descriptions', () => {
  const node = new SitemapUrlHealthCheck();
  assert.equal(node.description.displayName, 'Sitemap URL Health Check');
  assert.equal(node.description.credentials[0].name, 'apifySitemapHealthApi');
  const cred = new ApifySitemapHealthApi();
  assert.equal(cred.name, 'apifySitemapHealthApi');
  assert.equal(cred.displayName, 'Apify API');
  assert.equal(cred.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiToken}}');
});

test('evaluateResults matches the CLI and evaluate.jq', () => {
  const r = evaluateResults(items, parseFlagList('not_found, server_error,client_error'), summary);
  assert.deepEqual([r.checked, r.problems, r.failing, r.billed], [6, 5, 2, 5]);
  assert.equal(evaluateResults(items, parseFlagList('none'), {}).failing, 0);
  assert.equal(evaluateResults(items, [], {}).checked, 6);
});

function fakeContext(params, calls) {
  return {
    getInputData: () => [{ json: {} }],
    getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
    getNode: () => ({ name: 'Sitemap URL Health Check', type: 'sitemapUrlHealthCheck', typeVersion: 1, parameters: {} }),
    continueOnFail: () => false,
    helpers: {
      httpRequestWithAuthentication: async function (cred, opts) {
        calls.push({ cred, opts });
        const u = opts.url;
        if (opts.method === 'POST' && u.endsWith('/runs')) return { data: { id: 'RUN1', status: 'READY' } };
        if (u.includes('/actor-runs/RUN1')) return { data: { id: 'RUN1', status: 'SUCCEEDED', defaultDatasetId: 'DS', defaultKeyValueStoreId: 'KV' } };
        if (u.includes('/records/SUMMARY')) return summary;
        if (u.includes('/datasets/DS/items')) return items;
        throw new Error('unexpected ' + u);
      },
    },
  };
}

test('execute: summary output and Actor input', async () => {
  const calls = [];
  const ctx = fakeContext({ siteUrls: 'example.com', confirmPermission: true, maxUrls: 200, failOn: 'not_found,server_error' }, calls);
  const [out] = await new SitemapUrlHealthCheck().execute.call(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].json.failing, 2);
  assert.equal(out[0].json.checked, 6);
  assert.equal(calls[0].cred, 'apifySitemapHealthApi');
  assert.match(calls[0].opts.url, /\/v2\/acts\/lineagersiui~sitemap-url-health-checker\/runs$/);
  assert.deepEqual(calls[0].opts.body, { confirmPermission: true, maxUrls: 200, onlyProblems: true, siteUrls: ['example.com'] });
});

test('execute: rows output, error on failing, permission required', async () => {
  const node = new SitemapUrlHealthCheck();
  const [rows] = await node.execute.call(fakeContext({ siteUrls: 'example.com', confirmPermission: true, output: 'rows', failOn: 'not_found' }, []));
  assert.equal(rows.length, 5);
  assert.equal(rows[0].json.fail, true);
  await assert.rejects(node.execute.call(fakeContext({ siteUrls: 'example.com', confirmPermission: true, failOn: 'not_found', errorOnFailing: true }, [])), /matched Fail On/);
  const calls = [];
  await assert.rejects(node.execute.call(fakeContext({ siteUrls: 'example.com', confirmPermission: false }, calls)), /permission/);
  assert.equal(calls.length, 0);
  await assert.rejects(node.execute.call(fakeContext({ confirmPermission: true }, [])), /at least one site/);
});
