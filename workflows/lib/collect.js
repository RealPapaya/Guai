// Pure merge + dedupe across worker batches. Same signal reported by two workers
// collapses to one finding (highest severity wins; flags OR together; details merge).
// Node-side helper (used by the bridge); the Workflow sandbox inlines an equivalent.
import { fingerprint } from '../../core/fingerprint.js';

export function mergeAndDedupe(batches) {
  const map = new Map();
  for (const f of (batches ?? []).flat().filter(Boolean)) {
    const fp = fingerprint(f);
    const prev = map.get(fp);
    if (!prev) {
      map.set(fp, { ...f, fingerprint: fp });
    } else {
      map.set(fp, {
        ...prev,
        severity: Math.max(prev.severity ?? 0, f.severity ?? 0),
        timeCritical: !!(prev.timeCritical || f.timeCritical),
        worsening: !!(prev.worsening || f.worsening),
        needsMoreSignal: !!(prev.needsMoreSignal || f.needsMoreSignal),
        detail: { ...(prev.detail ?? {}), ...(f.detail ?? {}) },
      });
    }
  }
  return [...map.values()];
}
