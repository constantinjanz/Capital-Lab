type Bucket = { count: number; resetsAt: number }

const buckets = new Map<string, Bucket>()

export function consumeRateLimit(
  key: string,
  options: { limit: number; windowMs: number; now?: number },
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = options.now ?? Date.now()
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetsAt <= now) {
    bucket = { count: 0, resetsAt: now + options.windowMs }
  }
  if (bucket.count >= options.limit) {
    buckets.set(key, bucket)
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetsAt - now) / 1000)),
    }
  }
  bucket.count += 1
  buckets.set(key, bucket)
  return {
    allowed: true,
    remaining: options.limit - bucket.count,
    retryAfterSeconds: 0,
  }
}
