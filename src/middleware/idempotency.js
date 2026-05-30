const crypto = require('crypto');
const { claimKey, findActiveRecord, completeRecord, deleteRecord } = require('../db');

const POLL_INTERVAL_MS = 100;
const POLL_TIMEOUT_MS = 30_000;

function hashBody(body) {
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function waitForCompletion(key) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const record = findActiveRecord(key);

      if (!record || record.status === 'complete') {
        clearInterval(timer);
        resolve(record);
        return;
      }

      if (Date.now() - start > POLL_TIMEOUT_MS) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for in-flight request to complete'));
      }
    }, POLL_INTERVAL_MS);
  });
}

async function idempotencyMiddleware(req, res, next) {
  const key = req.headers['idempotency-key'];

  if (!key) {
    return res.status(400).json({ error: 'Missing required header: Idempotency-Key' });
  }

  const bodyHash = hashBody(req.body);

  // Check for an existing active record before trying to claim
  const existing = findActiveRecord(key);

  if (existing) {
    if (existing.status === 'pending') {
      // In-flight: wait for the first request to finish
      let record;
      try {
        record = await waitForCompletion(key);
      } catch {
        return res.status(503).json({ error: 'Request processing timed out. Please retry.' });
      }

      if (!record) {
        // First request failed and cleaned up — let this one through as fresh
        return handleFreshRequest(key, bodyHash, req, res, next);
      }

      return replayResponse(record, bodyHash, res);
    }

    // status === 'complete'
    return replayResponse(existing, bodyHash, res);
  }

  // Key not found — try to claim it
  const claimed = claimKey(key, bodyHash);

  if (!claimed) {
    // Lost a race: another request inserted between our check and our insert
    const raceRecord = findActiveRecord(key);
    if (raceRecord?.status === 'pending') {
      let record;
      try {
        record = await waitForCompletion(key);
      } catch {
        return res.status(503).json({ error: 'Request processing timed out. Please retry.' });
      }
      return replayResponse(record ?? raceRecord, bodyHash, res);
    }
    if (raceRecord) {
      return replayResponse(raceRecord, bodyHash, res);
    }
  }

  return handleFreshRequest(key, bodyHash, req, res, next);
}

function handleFreshRequest(key, bodyHash, req, res, next) {
  // Intercept res.json to capture the response before it's sent
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    completeRecord(key, res.statusCode, body);
    return originalJson(body);
  };

  // If the route throws or crashes, clean up the pending record
  res.on('finish', () => {
    if (res.statusCode >= 500) {
      deleteRecord(key);
    }
  });

  next();
}

function replayResponse(record, incomingBodyHash, res) {
  if (record.body_hash !== incomingBodyHash) {
    return res.status(409).json({
      error: 'Idempotency key already used for a different request body.',
    });
  }

  const body = JSON.parse(record.response_body);
  return res
    .status(record.status_code)
    .set('X-Cache-Hit', 'true')
    .json(body);
}

module.exports = idempotencyMiddleware;
