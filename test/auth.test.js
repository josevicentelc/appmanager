import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalAuthenticator, parseCookies } from '../src/auth.js';

test('creates and invalidates an HttpOnly authenticated session', () => {
  const auth = new LocalAuthenticator({ username: 'admin', password: 'correct horse battery staple', secureCookie: true });
  const result = auth.login({ username: 'admin', password: 'correct horse battery staple', ip: '127.0.0.1' });
  assert.equal(result.ok, true);
  assert.match(result.cookie, /HttpOnly/); assert.match(result.cookie, /SameSite=Strict/); assert.match(result.cookie, /Secure/);
  const request = { headers: { cookie: result.cookie.split(';')[0] } };
  assert.equal(auth.isAuthenticated(request), true);
  assert.match(auth.logout(request), /Max-Age=0/);
  assert.equal(auth.isAuthenticated(request), false);
  assert.ok(parseCookies(request.headers.cookie).appmanager_session);
});

test('throttles repeated invalid login attempts', () => {
  const auth = new LocalAuthenticator({ username: 'admin', password: 'secret', maxAttempts: 2 });
  assert.equal(auth.login({ username: 'admin', password: 'wrong', ip: '127.0.0.1' }).status, 401);
  assert.equal(auth.login({ username: 'admin', password: 'wrong', ip: '127.0.0.1' }).status, 401);
  assert.equal(auth.login({ username: 'admin', password: 'secret', ip: '127.0.0.1' }).status, 429);
});
