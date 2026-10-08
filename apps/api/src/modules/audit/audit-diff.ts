type Plain = Record<string, unknown>;

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object' && 'toJSON' in value) {
    return (value as { toJSON(): unknown }).toJSON();
  }
  return value;
}

/** Só os campos que mudaram, no formato { before, after }. Campos fora de `fields` nunca entram. */
export function auditDiff<T extends object>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
): { before: Plain; after: Plain } | null {
  const changedBefore: Plain = {};
  const changedAfter: Plain = {};
  for (const field of fields) {
    const a = normalize(before[field]);
    const b = normalize(after[field]);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changedBefore[field] = a;
      changedAfter[field] = b;
    }
  }
  return Object.keys(changedAfter).length ? { before: changedBefore, after: changedAfter } : null;
}
