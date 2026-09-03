function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Lightweight in-memory limiter for a single Discord 2 server process.
 * The key is Express's req.ip, which only honors proxy headers when the host
 * explicitly enables TRUST_PROXY=1 behind a trusted reverse proxy.
 */
export function createIpRateLimiter({
  max,
  windowMs,
  message = 'Too many requests. Please try again later.',
} = {}) {
  const limit = readPositiveInteger(max, 60);
  const duration = readPositiveInteger(windowMs, 60_000);
  const entries = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const current = entries.get(key);
    const entry = !current || now - current.startedAt >= duration
      ? { startedAt: now, count: 0 }
      : current;
    entry.count += 1;
    entries.set(key, entry);

    const remaining = Math.max(0, limit - entry.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((duration - (now - entry.startedAt)) / 1000));
    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((entry.startedAt + duration) / 1000)));

    if (entry.count > limit) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: message, retryAfterSeconds });
    }

    // Remove idle buckets occasionally without a dedicated timer.
    if (entries.size > 1_000) {
      for (const [entryKey, value] of entries) {
        if (now - value.startedAt >= duration) entries.delete(entryKey);
      }
    }
    next();
  };
}

export function envLimit(name, fallback) {
  return readPositiveInteger(process.env[name], fallback);
}
