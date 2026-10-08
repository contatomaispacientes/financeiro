import { describe, it, expect } from 'vitest';
import { onlyDigits, isValidCpf, isValidCnpj, isValidCpfOrCnpj, maskDocument } from '../document.js';

describe('onlyDigits', () => {
  it('strips formatting from CPF', () => {
    expect(onlyDigits('123.456.789-09')).toBe('12345678909');
  });

  it('strips formatting from CNPJ', () => {
    expect(onlyDigits('11.222.333/0001-81')).toBe('11222333000181');
  });

  it('returns empty for no digits', () => {
    expect(onlyDigits('abc')).toBe('');
  });
});

describe('isValidCpf', () => {
  it('accepts a valid CPF', () => {
    expect(isValidCpf('52998224725')).toBe(true);
  });

  it('accepts a formatted valid CPF', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
  });

  it('rejects all same digits', () => {
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('00000000000')).toBe(false);
  });

  it('rejects wrong check digits', () => {
    expect(isValidCpf('52998224726')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidCpf('123')).toBe(false);
    expect(isValidCpf('123456789012')).toBe(false);
  });
});

describe('isValidCnpj', () => {
  it('accepts a valid CNPJ', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
  });

  it('accepts a formatted valid CNPJ', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
  });

  it('rejects all same digits', () => {
    expect(isValidCnpj('11111111111111')).toBe(false);
  });

  it('rejects wrong check digits', () => {
    expect(isValidCnpj('11222333000182')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidCnpj('123')).toBe(false);
  });
});

describe('isValidCpfOrCnpj', () => {
  it('validates CPF', () => {
    expect(isValidCpfOrCnpj('52998224725')).toBe(true);
  });

  it('validates CNPJ', () => {
    expect(isValidCpfOrCnpj('11222333000181')).toBe(true);
  });

  it('rejects invalid length', () => {
    expect(isValidCpfOrCnpj('12345')).toBe(false);
  });
});

describe('maskDocument', () => {
  it('masks CPF: "12345678909" → "***.456.789-**"', () => {
    expect(maskDocument('12345678909')).toBe('***.456.789-**');
  });

  it('masks CNPJ: "11222333000181" → "**.222.333/0001-**"', () => {
    expect(maskDocument('11222333000181')).toBe('**.222.333/0001-**');
  });

  it('masks formatted input', () => {
    expect(maskDocument('123.456.789-09')).toBe('***.456.789-**');
  });
});
