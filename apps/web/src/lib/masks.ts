import { onlyDigits } from '@financeiro/shared';

function apply(digits: string, pattern: string): string {
  let out = '';
  let i = 0;
  for (const ch of pattern) {
    if (i >= digits.length) break;
    if (ch === '#') out += digits[i++];
    else out += ch;
  }
  return out;
}

/** Máscara progressiva: até 11 dígitos CPF, acima disso CNPJ (CLI-01.4: o schema guarda só dígitos). */
export function maskDocumentInput(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  return d.length <= 11 ? apply(d, '###.###.###-##') : apply(d, '##.###.###/####-##');
}

export function maskPhoneInput(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  return d.length <= 10 ? apply(d, '(##) ####-####') : apply(d, '(##) #####-####');
}

export function maskPostalCodeInput(value: string): string {
  return apply(onlyDigits(value).slice(0, 8), '#####-###');
}
