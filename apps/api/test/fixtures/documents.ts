let sequence = 100_000_000;

function checkDigit(digits: number[], startWeight: number): number {
  const sum = digits.reduce((acc, d, i) => acc + d * (startWeight - i), 0);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

/** CPF válido e único por chamada (só dígitos), para fixtures de teste. */
export function nextCpf(): string {
  sequence += 1;
  const base = String(sequence).padStart(9, '0').split('').map(Number);
  const d1 = checkDigit(base, 10);
  const d2 = checkDigit([...base, d1], 11);
  return [...base, d1, d2].join('');
}
