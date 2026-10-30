import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createServer } from 'vite';
import axios from 'axios';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { default: api, refreshAccessToken } = await server.ssrLoadModule('/src/services/api.ts');
const { readSession } = await server.ssrLoadModule('/src/services/session.ts');
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.window = new EventTarget();

after(async () => { await server.close(); });
beforeEach(() => storage.clear());

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function unauthorized(config) {
  return new axios.AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, { status: 401 });
}

test('login rejects HTML and incomplete successful responses', () => {
  assert.throws(() => readSession('<html>login page</html>'), /valid session/);
  assert.throws(() => readSession({ accessToken: 'token' }), /valid user session/);
  assert.throws(() => readSession({ accessToken: '' }), /valid session/);
  const session = { accessToken: 'token', user: { id: '1', email: 'test@example.com', role: 'Employee' } };
  assert.deepEqual(readSession(session), session);
});

test('concurrent session restores share one refresh request', async () => {
  let requests = 0;
  const response = deferred();
  axios.defaults.adapter = async () => { requests++; return response.promise; };
  const first = refreshAccessToken();
  const second = refreshAccessToken();
  assert.equal(first, second);
  response.resolve({ data: { accessToken: 'restored-token' } });
  await Promise.all([first, second]);
  assert.equal(requests, 1);
  assert.equal(localStorage.getItem('accessToken'), 'restored-token');
});

test('failed old refresh cannot log out a newly completed login', async () => {
  localStorage.setItem('accessToken', 'old-token');
  const response = deferred();
  axios.defaults.adapter = () => response.promise;
  const refresh = refreshAccessToken();
  localStorage.setItem('accessToken', 'new-login-token');
  let loggedOut = false;
  const handler = () => { loggedOut = true; };
  window.addEventListener('auth:logout', handler);
  response.reject(unauthorized({}));
  await assert.rejects(refresh);
  window.removeEventListener('auth:logout', handler);
  assert.equal(localStorage.getItem('accessToken'), 'new-login-token');
  assert.equal(loggedOut, false);
});

test('successful old refresh cannot overwrite a newly completed login', async () => {
  localStorage.setItem('accessToken', 'old-token');
  const response = deferred();
  axios.defaults.adapter = () => response.promise;
  const refresh = refreshAccessToken();
  localStorage.setItem('accessToken', 'new-login-token');
  response.resolve({ data: { accessToken: 'old-session-refreshed' } });
  await refresh;
  assert.equal(localStorage.getItem('accessToken'), 'new-login-token');
});

test('expired API requests refresh once and retry with the new token', async () => {
  localStorage.setItem('accessToken', 'expired-token');
  let refreshes = 0;
  axios.defaults.adapter = async () => {
    refreshes++;
    return { data: { accessToken: 'fresh-token' } };
  };
  api.defaults.adapter = async (config) => {
    if (config.headers.Authorization === 'Bearer expired-token') throw unauthorized(config);
    assert.equal(config.headers.Authorization, 'Bearer fresh-token');
    return { data: { id: '1' }, config };
  };
  await Promise.all([api.get('/auth/me'), api.get('/dashboard')]);
  assert.equal(refreshes, 1);
});

test('invalid credentials never trigger token refresh', async () => {
  localStorage.setItem('accessToken', 'old-token');
  let refreshes = 0;
  axios.defaults.adapter = async () => { refreshes++; return {}; };
  api.defaults.adapter = async (config) => { throw unauthorized(config); };
  await assert.rejects(api.post('/auth/login', { email: 'test@example.com', password: 'wrong' }));
  assert.equal(refreshes, 0);
});

test('a late API 401 retries with the newer login without refreshing it', async () => {
  localStorage.setItem('accessToken', 'old-token');
  const response = deferred();
  const started = deferred();
  let refreshes = 0;
  axios.defaults.adapter = async () => { refreshes++; return {}; };
  api.defaults.adapter = async (config) => {
    if (config.headers.Authorization === 'Bearer old-token') {
      started.resolve(config);
      return response.promise;
    }
    assert.equal(config.headers.Authorization, 'Bearer new-login-token');
    return { data: { id: 'new-user' }, config };
  };
  const request = api.get('/auth/me');
  const config = await started.promise;
  localStorage.setItem('accessToken', 'new-login-token');
  response.reject(unauthorized(config));
  assert.equal((await request).data.id, 'new-user');
  assert.equal(refreshes, 0);
});

test('temporary refresh outages preserve the session; rejected cookies clear it', async () => {
  localStorage.setItem('accessToken', 'existing-token');
  axios.defaults.adapter = async () => { throw new axios.AxiosError('Network Error'); };
  await assert.rejects(refreshAccessToken());
  assert.equal(localStorage.getItem('accessToken'), 'existing-token');
  axios.defaults.adapter = async () => { throw unauthorized({}); };
  await assert.rejects(refreshAccessToken());
  assert.equal(localStorage.getItem('accessToken'), null);
});
