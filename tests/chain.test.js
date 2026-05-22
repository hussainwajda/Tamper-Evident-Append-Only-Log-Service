require('dotenv').config();

process.env.API_KEY = 'test-key';

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/db/pool');
const { appendEntry, computeHash } = require('../src/services/chainService');

const authHeader = { 'x-api-key': 'test-key' };

beforeAll(() => {
  process.env.API_KEY = 'test-key';
  process.env.DATABASE_URL = process.env.DATABASE_URL;
});

beforeEach(async () => {
  await pool.query('TRUNCATE log_entries RESTART IDENTITY');
});

afterAll(async () => {
  await pool.end();
});

describe('tamper-evident chain API', () => {
  test('POST /log creates entry with correct hash', async () => {
    const response = await request(app)
      .post('/api/log')
      .set(authHeader)
      .send({
        actor: 'alice',
        action: 'create',
        payload: { value: 30, setting: 'retention_days' },
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.entry).toMatchObject({
      id: expect.any(Number),
      ulid: expect.any(String),
      entry_hash: expect.any(String),
    });

    const { entry } = response.body;
    const recomputed = computeHash({
      ulid: entry.ulid,
      actor: entry.actor,
      action: entry.action,
      payload: entry.payload,
      prev_hash: entry.prev_hash ?? null,
    });

    expect(recomputed).toBe(entry.entry_hash);
  });

  test('Chain links correctly between entries', async () => {
    const first = await appendEntry({
      actor: 'alice',
      action: 'create',
      payload: { item: 1 },
    });
    const second = await appendEntry({
      actor: 'bob',
      action: 'update',
      payload: { item: 2 },
    });

    expect(second.prev_hash).toBe(first.entry_hash);
    expect(first.prev_hash).toBeNull();
  });

  test('GET /verify returns pass on clean chain', async () => {
    await appendEntry({ actor: 'alice', action: 'one', payload: { step: 1 } });
    await appendEntry({ actor: 'alice', action: 'two', payload: { step: 2 } });
    await appendEntry({ actor: 'alice', action: 'three', payload: { step: 3 } });

    const response = await request(app)
      .get('/api/verify')
      .set(authHeader);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('pass');
    expect(response.body.total_checked).toBe(3);
  });

  test('GET /verify detects tampered chain', async () => {
    await appendEntry({ actor: 'alice', action: 'one', payload: { step: 1 } });
    await appendEntry({ actor: 'alice', action: 'two', payload: { step: 2 } });
    await appendEntry({ actor: 'alice', action: 'three', payload: { step: 3 } });
    await pool.query("UPDATE log_entries SET entry_hash = 'fakehash' WHERE id = 2");

    const response = await request(app)
      .get('/api/verify')
      .set(authHeader);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('fail');
    expect(response.body.broken_at).toBe(2);
  });

  test('POST /log without API key returns 401', async () => {
    const response = await request(app)
      .post('/api/log')
      .send({
        actor: 'alice',
        action: 'create',
        payload: { item: 1 },
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  test('GET /export filters by actor correctly', async () => {
    await appendEntry({ actor: 'alice', action: 'one', payload: { step: 1 } });
    await appendEntry({ actor: 'bob', action: 'two', payload: { step: 2 } });
    await appendEntry({ actor: 'alice', action: 'three', payload: { step: 3 } });

    const response = await request(app)
      .get('/api/export?actor=alice')
      .set(authHeader);

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(2);
    expect(response.body.entries.every((entry) => entry.actor === 'alice')).toBe(true);
  });
});
