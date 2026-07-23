import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { SESSION_COOKIE } from '../src/auth/session.ts';
import { TEST_PASSWORD, TEST_USERNAME } from './helpers/credentials.ts';
import { disconnect } from './helpers/db.ts';

let app: Express;

beforeAll(() => {
  app = createApp();
});

afterAll(async () => {
  await disconnect();
});

const login = (username: string, password: string) =>
  request(app).post('/api/auth/login').send({ username, password });

describe('POST /api/auth/login', () => {
  it('issues a session cookie for the right credentials', async () => {
    const response = await login(TEST_USERNAME, TEST_PASSWORD);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user: TEST_USERNAME });

    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain(SESSION_COOKIE);
    // Unreadable from JavaScript, so an XSS cannot lift the session.
    expect(cookie).toContain('HttpOnly');
    // Not sent on cross-site POSTs, which is the CSRF case that matters here.
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('rejects a wrong password', async () => {
    const response = await login(TEST_USERNAME, 'not-the-password');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('rejects an unknown user', async () => {
    const response = await login('someoneElse', TEST_PASSWORD);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  // The message must not say which half was wrong, or the endpoint becomes a way to
  // enumerate valid usernames.
  it('gives the same answer whether the user or the password was wrong', async () => {
    const badPassword = await login(TEST_USERNAME, 'wrong');
    const badUser = await login('nobody', TEST_PASSWORD);

    expect(badUser.body.error.message).toBe(badPassword.body.error.message);
    expect(badUser.body.error.code).toBe(badPassword.body.error.code);
  });

  it('validates the request body', async () => {
    const response = await request(app).post('/api/auth/login').send({ username: TEST_USERNAME });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('the session guard', () => {
  it('refuses every data route without a session', async () => {
    const paths = [
      '/api/suppliers',
      '/api/certificates',
      '/api/dashboard',
      '/api/chain',
      '/api/reference/countries',
      '/api/erp/sync-logs',
    ];

    for (const path of paths) {
      const response = await request(app).get(path);
      expect(response.status, `${path} should require a session`).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('refuses mutating routes too', async () => {
    expect((await request(app).post('/api/erp/sync')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/suppliers')
          .send({ name: 'X', countryCode: 'DE', category: 'LOGISTICS' })
      ).status,
    ).toBe(401);
  });

  /** A health probe cannot hold a cookie, so it has to stay open. */
  it('leaves the health endpoint reachable', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('rejects a tampered cookie', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
    });

    // A payload edited to extend its own life, without a matching signature.
    const forged = `${Buffer.from(
      JSON.stringify({ sub: TEST_USERNAME, exp: 9_999_999_999 }),
    ).toString('base64url')}.not-a-real-signature`;

    const response = await request(app)
      .get('/api/suppliers')
      .set('Cookie', `${SESSION_COOKIE}=${forged}`);

    expect(response.status).toBe(401);
  });

  it('admits a request carrying a genuine session', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
    });

    expect((await agent.get('/api/suppliers')).status).toBe(200);
    expect((await agent.get('/api/auth/me')).body).toEqual({ user: TEST_USERNAME });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the cookie, and the session stops working', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
    });
    expect((await agent.get('/api/suppliers')).status).toBe(200);

    expect((await agent.post('/api/auth/logout')).status).toBe(204);

    expect((await agent.get('/api/suppliers')).status).toBe(401);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('is 401 when not signed in, so the frontend can tell on load', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});
