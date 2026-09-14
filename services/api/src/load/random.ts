/**
 * A deterministic random source for the load harness.
 *
 * Load results are only comparable between runs if the data underneath them is
 * the same, so the generator is seeded and reproducible: `--seed 7` produces the
 * same quarter of a million residents on any machine, and a regression measured
 * today can be measured again next month against identical rows.
 *
 * This is not a security primitive and must never be used as one. It exists so
 * that a benchmark is repeatable; `node:crypto` remains the only source for
 * anything the platform depends on.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    // Any non-zero state will do; mixing keeps small seeds from starting in a
    // low-entropy corner of the sequence.
    this.state = (seed ^ 0x9e3779b9) >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
    for (let i = 0; i < 8; i += 1) this.next();
  }

  /** mulberry32: small, fast, and good enough to shape synthetic data. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new Error('pick from an empty list');
    return values[Math.floor(this.next() * values.length)] as T;
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /**
   * A value skewed towards the low end, which is how most real populations
   * distribute: a few names, places and officers account for most of the volume.
   */
  skewed(min: number, max: number, power = 2): number {
    const unit = Math.pow(this.next(), power);
    return min + Math.floor(unit * (max - min + 1));
  }
}

/**
 * Choose from a weighted list. Used by the driver to pick the next request, so
 * that the mix a run applies is the mix the profile declares.
 */
export function weightedChoice<T extends { readonly weight: number }>(
  items: readonly T[],
  roll: number,
): T {
  if (items.length === 0) throw new Error('weighted choice over an empty list');
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) throw new Error('weighted choice needs at least one positive weight');
  let target = roll * total;
  for (const item of items) {
    target -= item.weight;
    if (target < 0) return item;
  }
  return items[items.length - 1] as T;
}
