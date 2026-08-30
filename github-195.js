// app.js (or server.js) - Session cookie hardening
const session = require('express-session');

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// tests/sessionCookie.test.js - Integration tests
const request = require('supertest');
const app = require('../app');

describe('Session Cookie Hardening', () => {
  test('sets httpOnly flag', async () => {
    const res = await request(app).get('/test-session');
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  });

  test('sets secure flag in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const res = await request(app).get('/test-session');
    expect(res.headers['set-cookie'][0]).toMatch(/Secure/);
    process.env.NODE_ENV = originalEnv;
  });

  test('sets sameSite=strict', async () => {
    const res = await request(app).get('/test-session');
    expect(res.headers['set-cookie'][0]).toMatch(/SameSite=Strict/);
  });
});