import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(String(value)).digest();

export function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const separator = entry.indexOf('=');
    return separator < 0 ? [entry, ''] : [entry.slice(0, separator), decodeURIComponent(entry.slice(separator + 1))];
  }));
}

export class LocalAuthenticator {
  constructor({ username, password, secureCookie = false, sessionHours = 12, maxAttempts = 5, attemptWindowMs = 15 * 60_000 }) {
    this.username = username; this.passwordDigest = digest(password); this.secureCookie = secureCookie;
    this.sessionMs = sessionHours * 60 * 60_000; this.maxAttempts = maxAttempts; this.attemptWindowMs = attemptWindowMs;
    this.sessions = new Map(); this.attempts = new Map();
  }
  cookie(value, maxAge = null) {
    return `appmanager_session=${value}; Path=/; HttpOnly; SameSite=Strict${this.secureCookie ? '; Secure' : ''}${maxAge === null ? '' : `; Max-Age=${maxAge}`}`;
  }
  cleanup(now = Date.now()) {
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
    for (const [ip, attempt] of this.attempts) if (attempt.resetAt <= now) this.attempts.delete(ip);
  }
  isAuthenticated(request) {
    this.cleanup();
    const id = parseCookies(request.headers.cookie).appmanager_session;
    const session = id && this.sessions.get(id);
    return Boolean(session && session.expiresAt > Date.now());
  }
  login({ username, password, ip }) {
    this.cleanup();
    const attempt = this.attempts.get(ip);
    if (attempt && attempt.count >= this.maxAttempts) return { ok: false, status: 429, error: 'Demasiados intentos. Inténtalo más tarde.' };
    const validUsername = timingSafeEqual(digest(username), digest(this.username));
    const validPassword = timingSafeEqual(digest(password), this.passwordDigest);
    if (!validUsername || !validPassword) {
      this.attempts.set(ip, { count: (attempt?.count ?? 0) + 1, resetAt: attempt?.resetAt ?? Date.now() + this.attemptWindowMs });
      return { ok: false, status: 401, error: 'Usuario o contraseña incorrectos.' };
    }
    this.attempts.delete(ip);
    const id = randomBytes(32).toString('base64url'); const expiresAt = Date.now() + this.sessionMs;
    this.sessions.set(id, { expiresAt });
    return { ok: true, cookie: this.cookie(id), expiresAt };
  }
  logout(request) {
    const id = parseCookies(request.headers.cookie).appmanager_session;
    if (id) this.sessions.delete(id);
    return this.cookie('', 0);
  }
}
