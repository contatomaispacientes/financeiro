/**
 * CPF/CNPJ validation and masking utilities.
 */

/**
 * Strips non-digit characters.
 */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Validates a CPF (11 digits) with check digits.
 */
export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;

  // Reject known invalid sequences (all same digit)
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  // First check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cpf[i]!, 10) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(cpf[9]!, 10)) return false;

  // Second check digit
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cpf[i]!, 10) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(cpf[10]!, 10)) return false;

  return true;
}

/**
 * Validates a CNPJ (14 digits) with check digits.
 */
export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14) return false;

  // Reject all same digit
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  // First check digit
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cnpj[i]!, 10) * weights1[i]!;
  }
  let remainder = sum % 11;
  const digit1 = remainder < 2 ? 0 : 11 - remainder;
  if (digit1 !== parseInt(cnpj[12]!, 10)) return false;

  // Second check digit
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(cnpj[i]!, 10) * weights2[i]!;
  }
  remainder = sum % 11;
  const digit2 = remainder < 2 ? 0 : 11 - remainder;
  if (digit2 !== parseInt(cnpj[13]!, 10)) return false;

  return true;
}

/**
 * Validates either CPF or CNPJ.
 */
export function isValidCpfOrCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

/**
 * Masks a document for display. Shows only the middle portion.
 * CPF: "***.456.789-**"
 * CNPJ: "**.*56.789/0001-**"
 */
export function maskDocument(value: string): string {
  const digits = onlyDigits(value);

  if (digits.length === 11) {
    // CPF: ***.XXX.XXX-**
    return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  }

  if (digits.length === 14) {
    // CNPJ: **.XXX.XXX/XXXX-**
    return `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`;
  }

  // Unknown format — mask all
  return '*'.repeat(digits.length);
}

/**
 * Formats a stored document (digits only) for display (CLI-01.4).
 * "52998224725" → "529.982.247-25"; "11222333000181" → "11.222.333/0001-81". Unknown length: returned as is.
 */
export function formatDocument(value: string): string {
  const d = onlyDigits(value);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return value;
}

/** "11999990000" → "(11) 99999-0000"; "1133334444" → "(11) 3333-4444". Unknown length: returned as is. */
export function formatPhone(value: string): string {
  const d = onlyDigits(value);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return value;
}

/** "01310100" → "01310-100". */
export function formatPostalCode(value: string): string {
  const d = onlyDigits(value);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : value;
}
