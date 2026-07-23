/**
 * Kept in their own module because tests/setup.ts must read them before any application
 * module loads, and importing the auth helper from there would pull in env.ts too early.
 */
export const TEST_USERNAME = 'testUser';
export const TEST_PASSWORD = 'test-password-for-the-suite';
