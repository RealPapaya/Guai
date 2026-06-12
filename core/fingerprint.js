// Stable dedupe identity for a finding. Pure (crypto only) so the gate/scoring
// can import it without pulling in the database layer.
import { createHash } from 'node:crypto';

/**
 * A finding's fingerprint is what makes "the same signal seen again" dedupe to one
 * row. Monitors should supply a stable `key` for signals whose title varies
 * (e.g. "ci:owner/repo:main"); otherwise the title is used.
 */
export function fingerprint(f) {
  if (f.fingerprint) return f.fingerprint;
  const key = `${f.source}|${f.target_ref ?? ''}|${f.kind}|${f.key ?? f.title}`;
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}
