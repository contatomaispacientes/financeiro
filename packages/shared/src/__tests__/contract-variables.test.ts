import { describe, expect, it } from 'vitest';
import { formatBRL } from '../money.js';
import { resolveContractVariables, type ContractVariablesInput } from '../contract-variables.js';
import { ContractDraftSchema } from '../schemas/contract.js';

const base: ContractVariablesInput = {
  customer: {
    name: 'Padaria Bom Grão Ltda',
    document: '11222333000181',
    personType: 'PJ',
    email: 'contato@bomgrao.com',
    phone: '11999990000',
    address: { postalCode: '01310100', street: 'Av. Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', state: 'SP' },
  },
  plan: {
    items: [{ description: 'Gestão de redes', quantity: 1, unitPriceCents: 270_000 }],
    type: 'INSTALLMENT',
    installmentCount: 3,
    billingType: 'UNDEFINED',
    dueDate: { mode: 'DAYS_AFTER_SIGNATURE', days: 3 },
    discountCents: 0,
    finePct: 2,
    interestPct: 1,
  },
  settings: { companyName: 'Minha Empresa', companyDocument: '11444777000161', companyCity: 'São Paulo' },
  variableMap: { nome: 'cliente.nome', endereco: 'cliente.endereco', condicao: 'cobranca.condicao', vencimento: 'cobranca.vencimento' },
  today: '2026-10-07',
  minChargeCents: 500,
};

describe('resolveContractVariables', () => {
  it('[CTR-02.5] formata em pt-BR e deixa "N dias após a assinatura" em texto no rascunho', () => {
    const r = resolveContractVariables(base);
    expect(r.variables).toMatchObject({
      'cliente.documento': '11.222.333/0001-81',
      'cliente.tipo': 'pessoa jurídica',
      'cliente.endereco': 'Av. Paulista, 1000 — Bela Vista — São Paulo/SP — CEP 01310-100',
      'cobranca.condicao': `3 parcelas de ${formatBRL(90_000)}`,
      'cobranca.vencimento': '3 dias após a assinatura',
      'cobranca.forma': 'Pix, boleto ou cartão',
      'cobranca.juros': '1% ao mês',
      'contrato.data': '07 de outubro de 2026',
    });
    expect(r.fields).toEqual({
      nome: 'Padaria Bom Grão Ltda',
      endereco: expect.stringContaining('Av. Paulista'),
      condicao: `3 parcelas de ${formatBRL(90_000)}`,
      vencimento: '3 dias após a assinatura',
    });
    expect(r.missing).toEqual([]);
  });

  it('[CTR-02.5] assinado: vencimento vira a data', () => {
    const r = resolveContractVariables({ ...base, signedAt: new Date('2026-10-07T15:00:00Z') });
    expect(r.variables['cobranca.vencimento']).toBe('10/10/2026');
  });

  it('[CTR-02.6] lista só as variáveis usadas pelo modelo que não dá para preencher', () => {
    const r = resolveContractVariables({
      ...base,
      customer: { ...base.customer, address: null, email: null },
      variableMap: { ...base.variableMap, cidade: 'contrato.cidade' },
      settings: { ...base.settings, companyCity: '' },
    });
    expect(r.missing.sort()).toEqual(['cliente.endereco', 'contrato.cidade']);
    expect(r.addressComplete).toBe(false);
  });
});

describe('ContractDraftSchema', () => {
  const signer = { name: 'Fulano', email: 'f@x.com' };
  const draft = (signers: object[]) =>
    ContractDraftSchema.safeParse({ customerId: '0f8f5a3e-1c2d-4e5f-8a9b-1234567890ab', templateId: '6b1d2c3e-4f5a-4b6c-9d7e-0a1b2c3d4e5f', title: 'Contrato', chargePlan: base.plan, signers });

  it('[CTR-02.3] exige um cliente e ao menos um da empresa', () => {
    expect(draft([{ ...signer, role: 'CLIENT' }, { ...signer, role: 'COMPANY' }]).success).toBe(true);
    expect(draft([{ ...signer, role: 'COMPANY' }, { ...signer, role: 'COMPANY' }]).success).toBe(false);
    expect(draft([{ ...signer, role: 'CLIENT' }, { ...signer, role: 'CLIENT' }]).success).toBe(false);
  });

  it('[CTR-02.8] WhatsApp e SMS pedem celular', () => {
    expect(draft([{ ...signer, role: 'CLIENT', authMethod: 'whatsapp' }, { ...signer, role: 'COMPANY' }]).success).toBe(false);
    expect(draft([{ ...signer, role: 'CLIENT', authMethod: 'sms', phone: '(11) 99999-0000' }, { ...signer, role: 'COMPANY' }]).success).toBe(true);
  });
});
