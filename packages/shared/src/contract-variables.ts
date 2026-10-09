import { formatDocument, formatPhone, formatPostalCode } from './document.js';
import { formatBRL } from './money.js';
import { calculatePlan } from './plan.js';
import { isAddressComplete } from './schemas/customer.js';
import type { ChargePlan, PlanCalculation } from './schemas/charge-plan.js';
import type { ContractPreviewDto, ContractVariable } from './schemas/contract.js';
import { VARIABLE_CATALOG } from './schemas/contract.js';

export interface ContractVariablesInput {
  customer: {
    name: string;
    document: string;
    personType: 'PF' | 'PJ';
    email: string | null;
    phone: string | null;
    address: unknown;
  };
  plan: ChargePlan;
  settings: { companyName: string | null; companyDocument: string | null; companyCity: string | null };
  variableMap: Record<string, string>;
  today: string;
  minChargeCents: number;
  /** Ausente (rascunho): "N dias após a assinatura" fica em texto. */
  signedAt?: Date;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const BILLING: Record<ChargePlan['billingType'], string> = {
  PIX: 'Pix',
  BOLETO: 'boleto',
  CREDIT_CARD: 'cartão de crédito',
  UNDEFINED: 'Pix, boleto ou cartão',
};
const CYCLES: Record<NonNullable<ChargePlan['cycle']>, string> = {
  WEEKLY: 'semanal',
  BIWEEKLY: 'quinzenal',
  MONTHLY: 'mensal',
  BIMONTHLY: 'bimestral',
  QUARTERLY: 'trimestral',
  SEMIANNUALLY: 'semestral',
  YEARLY: 'anual',
};

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const longDate = (iso: string) => `${iso.slice(8, 10)} de ${MONTHS[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
const pct = (n: number) => `${n.toLocaleString('pt-BR')}%`;
const filled = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

function address(raw: unknown): string | null {
  if (!isAddressComplete(raw)) return null;
  const a = raw as { street: string; number: string; complement?: string | null; district: string; city: string; state: string; postalCode: string };
  const line = [a.street, a.number, a.complement].filter(Boolean).join(', ');
  return `${line} — ${a.district} — ${a.city}/${a.state} — CEP ${formatPostalCode(a.postalCode)}`;
}

function condition(plan: ChargePlan, calc: PlanCalculation): string {
  if (plan.type === 'INSTALLMENT') {
    const [first, ...rest] = calc.installments;
    const last = rest.at(-1);
    const base = `${calc.installments.length} parcelas de ${formatBRL(first!.valueCents)}`;
    return last && last.valueCents !== first!.valueCents ? `${base} (a última de ${formatBRL(last.valueCents)})` : base;
  }
  if (plan.type === 'RECURRING') return `${CYCLES[plan.cycle!]} de ${formatBRL(calc.totalCents)}`;
  return 'pagamento único';
}

/**
 * Catálogo de variáveis do contrato (CTR-02.5, CTR-02.6) em pt-BR, campos do modelo resolvidos e o que falta.
 * Sem `signedAt`, o plano é calculado como se fosse assinado hoje só para os totais e parcelas.
 */
export function resolveContractVariables(input: ContractVariablesInput): ContractPreviewDto {
  const { customer, plan, settings } = input;
  const signedAt = input.signedAt ?? new Date(`${input.today}T12:00:00-03:00`);
  const result = calculatePlan(plan, { today: input.today, signedAt, minChargeCents: input.minChargeCents });
  const calc = result.ok ? result.value : null;

  const dueText =
    plan.dueDate.mode === 'FIXED_DATE'
      ? br(plan.dueDate.date)
      : input.signedAt && calc
        ? br(calc.firstDueDate)
        : `${plan.dueDate.days} ${plan.dueDate.days === 1 ? 'dia' : 'dias'} após a assinatura`;

  const variables: Record<ContractVariable, string | null> = {
    'cliente.nome': filled(customer.name),
    'cliente.documento': formatDocument(customer.document),
    'cliente.tipo': customer.personType === 'PJ' ? 'pessoa jurídica' : 'pessoa física',
    'cliente.email': filled(customer.email),
    'cliente.telefone': customer.phone ? formatPhone(customer.phone) : null,
    'cliente.endereco': address(customer.address),
    'empresa.nome': filled(settings.companyName),
    'empresa.documento': settings.companyDocument ? formatDocument(settings.companyDocument) : null,
    'servicos.lista': plan.items
      .map((i) => `${i.description} (${i.quantity}x) — ${formatBRL(i.quantity * i.unitPriceCents)}`)
      .join('; '),
    'servicos.total': calc ? formatBRL(calc.subtotalCents) : null,
    'cobranca.desconto': formatBRL(plan.discountCents ?? 0),
    'cobranca.valor_total': calc ? formatBRL(calc.totalCents) : null,
    'cobranca.forma': BILLING[plan.billingType],
    'cobranca.condicao': calc ? condition(plan, calc) : null,
    'cobranca.vencimento': dueText,
    'cobranca.multa': pct(plan.finePct),
    'cobranca.juros': `${pct(plan.interestPct)} ao mês`,
    'contrato.data': longDate(input.today),
    'contrato.cidade': filled(settings.companyCity),
  };

  const fields: Record<string, string | null> = {};
  const missing = new Set<ContractVariable>();
  for (const [field, variable] of Object.entries(input.variableMap)) {
    const known = (VARIABLE_CATALOG as readonly string[]).includes(variable);
    const value = known ? variables[variable as ContractVariable] : null;
    fields[field] = value;
    if (known && value === null) missing.add(variable as ContractVariable);
  }

  return {
    variables,
    fields,
    missing: [...missing],
    addressComplete: isAddressComplete(customer.address),
    plan: calc,
    planError: result.ok ? null : result.error.message,
  };
}
