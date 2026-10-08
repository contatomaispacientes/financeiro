import { describe, it, expect } from 'vitest';
import {
  AddressSchema,
  CustomerCreateSchema,
  CustomerUpdateSchema,
  isAddressComplete,
  personTypeFromDocument,
} from '../schemas/customer.js';
import { formatDocument, formatPhone, formatPostalCode } from '../document.js';

const CPF = '52998224725';
const CNPJ = '11222333000181';

const address = {
  postalCode: '01310-100',
  street: 'Av. Paulista',
  number: '1000',
  district: 'Bela Vista',
  city: 'São Paulo',
  state: 'sp',
};

function issues(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) {
  return Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]));
}

describe('CustomerCreateSchema', () => {
  it('[CLI-01.1] exige nome e CPF ou CNPJ válidos', () => {
    const r = CustomerCreateSchema.safeParse({ name: 'A', document: '52998224726' });
    expect(r.success).toBe(false);
    expect(issues(r)).toMatchObject({
      name: 'Informe o nome (mínimo 2 caracteres)',
      document: 'CPF ou CNPJ inválido',
    });
  });

  it('[CLI-01.1] nome de 2 a 120 caracteres, sem espaços nas pontas', () => {
    expect(CustomerCreateSchema.parse({ name: '  Ana  ', document: CPF }).name).toBe('Ana');
    expect(CustomerCreateSchema.safeParse({ name: 'x'.repeat(121), document: CPF }).success).toBe(false);
    expect(CustomerCreateSchema.safeParse({ name: '   ', document: CPF }).success).toBe(false);
  });

  it.each([
    ['CPF com máscara', '529.982.247-25', CPF],
    ['CPF só dígitos', CPF, CPF],
    ['CNPJ com máscara', '11.222.333/0001-81', CNPJ],
  ])('[CLI-01.4] %s é guardado só com dígitos', (_label, input, stored) => {
    expect(CustomerCreateSchema.parse({ name: 'Cliente', document: input }).document).toBe(stored);
  });

  it('[CLI-01.1] rejeita documento com tamanho que não é CPF nem CNPJ e sequências repetidas', () => {
    for (const document of ['123', '111.111.111-11', '00000000000000', '']) {
      expect(CustomerCreateSchema.safeParse({ name: 'Cliente', document }).success, document).toBe(false);
    }
  });

  it('[CLI-01.1] tipo PF/PJ vem do tamanho do documento', () => {
    expect(personTypeFromDocument(CPF)).toBe('PF');
    expect(personTypeFromDocument('11.222.333/0001-81')).toBe('PJ');
  });

  it('[CLI-01.2] só nome e documento são obrigatórios; régua ligada por padrão', () => {
    expect(CustomerCreateSchema.parse({ name: 'Cliente', document: CPF })).toEqual({
      name: 'Cliente',
      document: CPF,
      remindersEnabled: true,
    });
  });

  it('[CLI-01.2] aceita todos os campos opcionais e normaliza', () => {
    const parsed = CustomerCreateSchema.parse({
      name: 'Tech Solutions Ltda',
      document: '11.222.333/0001-81',
      email: '  Contato@TechSol.COM ',
      phone: '(11) 99999-0001',
      address: { ...address, complement: '  ' },
      notes: '  Cliente desde 2020 ',
      remindersEnabled: false,
    });
    expect(parsed).toEqual({
      name: 'Tech Solutions Ltda',
      document: CNPJ,
      email: 'contato@techsol.com',
      phone: '11999990001',
      address: {
        postalCode: '01310100',
        street: 'Av. Paulista',
        number: '1000',
        complement: null,
        district: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
      },
      notes: 'Cliente desde 2020',
      remindersEnabled: false,
    });
  });

  it('[CLI-01.2] campos opcionais vazios viram null', () => {
    const parsed = CustomerCreateSchema.parse({ name: 'Cliente', document: CPF, email: '', phone: '', notes: ' ' });
    expect(parsed).toMatchObject({ email: null, phone: null, notes: null });
  });

  it('[CLI-01.2] valida e-mail, celular com DDD e observações', () => {
    const r = CustomerCreateSchema.safeParse({
      name: 'Cliente',
      document: CPF,
      email: 'nao-e-email',
      phone: '99999-0000',
      notes: 'x'.repeat(2001),
    });
    expect(issues(r)).toMatchObject({
      email: 'E-mail inválido',
      phone: 'Celular com DDD (10 ou 11 dígitos)',
    });
    expect(issues(r)).toHaveProperty('notes');
    expect(CustomerCreateSchema.safeParse({ name: 'Cliente', document: CPF, phone: '1133334444' }).success).toBe(true);
  });
});

describe('AddressSchema', () => {
  it('[CLI-01.2] valida CEP, UF e campos obrigatórios do endereço', () => {
    const r = AddressSchema.safeParse({ postalCode: '0131', street: '', number: '', district: 'B', city: 'S', state: 'XX' });
    expect(issues(r)).toMatchObject({
      postalCode: 'CEP com 8 dígitos',
      street: 'Informe o logradouro',
      number: 'Informe o número (ou "S/N")',
      district: 'Informe o bairro',
      city: 'Informe a cidade',
      state: 'UF inválida',
    });
  });
});

describe('isAddressComplete', () => {
  it('[CLI-01.5] completo só com todos os campos obrigatórios válidos', () => {
    expect(isAddressComplete(address)).toBe(true);
    expect(isAddressComplete(undefined)).toBe(false);
    expect(isAddressComplete(null)).toBe(false);
    expect(isAddressComplete({ ...address, number: '' })).toBe(false);
    expect(isAddressComplete({ postalCode: '01310100' })).toBe(false);
  });
});

describe('CustomerUpdateSchema', () => {
  it('[CLI-04.1] parcial: PATCH só com nome não devolve remindersEnabled', () => {
    expect(CustomerUpdateSchema.parse({ name: 'Novo nome' })).toEqual({ name: 'Novo nome' });
  });

  it('[CLI-04.1] null apaga campos opcionais; documento continua validado', () => {
    expect(CustomerUpdateSchema.parse({ email: null, address: null })).toEqual({ email: null, address: null });
    expect(CustomerUpdateSchema.safeParse({ document: '123' }).success).toBe(false);
  });
});

describe('formatação para exibição', () => {
  it('[CLI-01.4] documento guardado só com dígitos é exibido formatado', () => {
    expect(formatDocument(CPF)).toBe('529.982.247-25');
    expect(formatDocument(CNPJ)).toBe('11.222.333/0001-81');
    expect(formatDocument('123')).toBe('123');
  });

  it('celular e CEP', () => {
    expect(formatPhone('11999990001')).toBe('(11) 99999-0001');
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444');
    expect(formatPostalCode('01310100')).toBe('01310-100');
  });
});
