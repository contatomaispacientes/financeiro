import { randomInt } from 'node:crypto';

function checkDigit(digits: number[], startWeight: number): number {
  const sum = digits.reduce((acc, d, i) => acc + d * (startWeight - i), 0);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

/**
 * CPF válido (só dígitos) para fixtures. Sorteado a cada chamada: cada arquivo de teste roda em
 * processo próprio sobre o mesmo banco, então um contador local repetiria documentos entre arquivos.
 */
export function nextCpf(): string {
  let base: number[];
  do {
    base = String(randomInt(100_000_000, 1_000_000_000)).split('').map(Number);
  } while (base.every((d) => d === base[0]));
  const d1 = checkDigit(base, 10);
  const d2 = checkDigit([...base, d1], 11);
  return [...base, d1, d2].join('');
}
