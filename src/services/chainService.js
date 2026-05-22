const crypto = require('crypto');
const { ulid } = require('ulid');
const pool = require('../db/pool');

function normalizePayload(payload) {
  if (Array.isArray(payload)) {
    return payload.map((item) => (
      typeof item === 'object' && item !== null ? normalizePayload(item) : item
    ));
  }

  if (typeof payload !== 'object' || payload === null) {
    return payload;
  }

  const sorted = {};
  Object.keys(payload).sort().forEach((key) => {
    sorted[key] = typeof payload[key] === 'object' && payload[key] !== null
      ? normalizePayload(payload[key])
      : payload[key];
  });
  return sorted;
}
// Fixed ordering keeps the same logical entry from producing different hashes across runtimes.
function computeHash(data) {
  const payload = normalizePayload(JSON.parse(JSON.stringify(data.payload)));

  const orderedData = {
    ulid: data.ulid,
    actor: data.actor,
    action: data.action,
    payload,
    prev_hash: data.prev_hash ?? null,
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(orderedData))
    .digest('hex');
}


// A single transaction and table lock prevent concurrent appenders from choosing the same predecessor.
async function appendEntry({ actor, action, payload }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE log_entries IN EXCLUSIVE MODE');

    const lastEntryResult = await client.query(
      'SELECT id, entry_hash FROM log_entries ORDER BY id DESC LIMIT 1 FOR UPDATE'
    );

    const lastEntry = lastEntryResult.rows[0];
    const prev_hash = lastEntry ? lastEntry.entry_hash : null;
    const id = ulid();
    const normalizedPayload = normalizePayload(JSON.parse(JSON.stringify(payload)));
    const entry_hash = computeHash({ ulid: id, actor, action, payload: normalizedPayload, prev_hash });

    const insertResult = await client.query(
      `
        INSERT INTO log_entries (ulid, actor, action, payload, prev_hash, entry_hash)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, ulid, actor, action, payload, prev_hash, entry_hash, created_at
      `,
      [id, actor, action, normalizedPayload, prev_hash, entry_hash]
    );

    await client.query('COMMIT');
    return insertResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Recomputing one row's digest detects direct tampering without requiring a full-chain scan.
async function verifyEntry(id) {
  const entryResult = await pool.query(
    `
      SELECT id, ulid, actor, action, payload, prev_hash, entry_hash, created_at
      FROM log_entries
      WHERE id = $1
    `,
    [id]
  );

  const entry = entryResult.rows[0];

  if (!entry) {
    return { valid: false, reason: 'Entry not found' };
  }

  const recomputedHash = computeHash({
    ulid: entry.ulid,
    actor: entry.actor,
    action: entry.action,
    payload: entry.payload,
    prev_hash: entry.prev_hash ?? null,
  });
  const valid = recomputedHash === entry.entry_hash;

  return valid
    ? { valid, entry }
    : { valid, entry, reason: 'Entry hash mismatch' };
}

// Walking in insertion order catches both modified entries and broken links between neighbors.
async function verifyChain() {
  const entriesResult = await pool.query(
    `
      SELECT id, ulid, actor, action, payload, prev_hash, entry_hash, created_at
      FROM log_entries
      ORDER BY id ASC
    `
  );

  const entries = entriesResult.rows;
  let previousHash = null;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const recomputedHash = computeHash({
      ulid: entry.ulid,
      actor: entry.actor,
      action: entry.action,
      payload: entry.payload,
      prev_hash: entry.prev_hash,
    });
    const totalChecked = index + 1;

    if (recomputedHash !== entry.entry_hash || entry.prev_hash !== previousHash) {
      return { status: 'fail', broken_at: entry.id, total_checked: totalChecked };
    }

    previousHash = entry.entry_hash;
  }

  return { status: 'pass', total_checked: entries.length };
}

module.exports = { computeHash, normalizePayload, appendEntry, verifyEntry, verifyChain };
