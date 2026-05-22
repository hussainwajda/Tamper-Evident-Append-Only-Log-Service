const express = require('express');
const authMiddleware = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimit');
const pool = require('../db/pool');
const { appendEntry, verifyEntry, verifyChain } = require('../services/chainService');

const router = express.Router();

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLimit(value) {
  if (value === undefined) {
    return 100;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(parsed, 1000);
}

function parseDate(value) {
  if (value === undefined) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// Auth is checked before rate limiting so invalid clients do not consume write quota.
router.post('/log', authMiddleware, rateLimiter, async (req, res) => {
  const fields = [];
  const body = req.body || {};
  const { actor, action } = body;
  const payload = body.payload === undefined ? {} : body.payload;

  if (typeof actor !== 'string') {
    fields.push('actor');
  }

  if (typeof action !== 'string') {
    fields.push('action');
  }

  if (!isPlainObject(payload)) {
    fields.push('payload');
  }

  if (fields.length > 0) {
    return res.status(400).json({ error: 'Validation failed', fields });
  }

  try {
    const entry = await appendEntry({ actor, action, payload });
    return res.status(201).json({ success: true, entry });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to append entry', message: err.message });
  }
});

// Single-entry lookup verifies the row while avoiding a full-chain scan on read.
router.get('/log/:id', authMiddleware, async (req, res, next) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Validation failed', fields: ['id'] });
  }

  try {
    const result = await verifyEntry(id);

    if (!result.entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    return res.status(200).json({ entry: result.entry, chain_valid: result.valid });
  } catch (err) {
    return next(err);
  }
});

// Full-chain verification is exposed separately because it is intentionally more expensive.
router.get('/verify', authMiddleware, async (req, res, next) => {
  try {
    const result = await verifyChain();
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

// Export uses parameterized dynamic filters so clients can page audit data without SQL injection risk.
router.get('/export', authMiddleware, async (req, res, next) => {
  const fields = [];
  const values = [];
  const conditions = [];
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  const limit = parseLimit(req.query.limit);

  if (from === undefined) {
    fields.push('from');
  }

  if (to === undefined) {
    fields.push('to');
  }

  if (limit === null) {
    fields.push('limit');
  }

  if (req.query.actor !== undefined && typeof req.query.actor !== 'string') {
    fields.push('actor');
  }

  if (fields.length > 0) {
    return res.status(400).json({ error: 'Validation failed', fields });
  }

  if (from) {
    values.push(from);
    conditions.push(`created_at >= $${values.length}`);
  }

  if (to) {
    values.push(to);
    conditions.push(`created_at <= $${values.length}`);
  }

  if (req.query.actor !== undefined) {
    values.push(req.query.actor);
    conditions.push(`actor = $${values.length}`);
  }

  values.push(limit);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `
    SELECT id, ulid, actor, action, payload, prev_hash, entry_hash, created_at
    FROM log_entries
    ${whereClause}
    ORDER BY id ASC
    LIMIT $${values.length}
  `;

  try {
    const result = await pool.query(query, values);
    return res.status(200).json({ count: result.rows.length, entries: result.rows });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
