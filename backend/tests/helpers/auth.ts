import type { Express } from 'express';
import request from 'supertest';

import { TEST_PASSWORD, TEST_USERNAME } from './credentials.ts';

export type ApiAgent = ReturnType<typeof request.agent>;

/**
 * A supertest agent that has signed in and keeps the session cookie.
 *
 * The suites drive the API through this rather than through bare `request(app)`, which
 * means every existing test now also asserts, implicitly, that the route it exercises
 * is reachable *with* a session — and the dedicated auth tests assert the other half,
 * that it is not reachable without one.
 */
export async function signIn(app: Express): Promise<ApiAgent> {
  const agent = request.agent(app);

  const response = await agent
    .post('/api/auth/login')
    .send({ username: TEST_USERNAME, password: TEST_PASSWORD });

  if (response.status !== 200) {
    throw new Error(`Test sign-in failed: ${String(response.status)} ${response.text}`);
  }

  return agent;
}
