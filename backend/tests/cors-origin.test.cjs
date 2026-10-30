// Run after npm run build: node --test tests/cors-origin.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.PUBLIC_APP_ORIGIN = 'https://sphere-test.centralindia.azurecontainerapps.io';
process.env.CLIENT_URL = 'https://hr.example.com';
// Route imports reference the live server. Isolate it to avoid starting cron jobs.
const serverPath = require.resolve('../dist/src/server');
require.cache[serverPath] = { id: serverPath, filename: serverPath, loaded: true, exports: { io: { emit() {} } } };
const app = require('../dist/src/app').default;

test('Microsoft callback accepts configured app origins but rejects other origins', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/auth/microsoft`;
  try {
    for (const origin of [process.env.PUBLIC_APP_ORIGIN, process.env.CLIENT_URL]) {
      const response = await fetch(url, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
      });
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal((await response.json()).message, 'idToken required');
    }
    const response = await fetch(url, {
      method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.status, 500);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
