import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  addDays,
  resolveContractVariables,
  todayInSaoPaulo,
  VARIABLE_CATALOG,
  type ChargePlan,
  type ContractPreviewDto,
  type ContractProviderName,
  type ContractTemplateDto,
  type ContractVariable,
  type TemplateUpdateInput,
  type TemplateUpsertInput,
} from '@financeiro/shared';
import type { Env } from '../../config/env.schema';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import type { ContractTemplate } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { templateNotFound, templateUnknownVariable } from './contracts.errors';

export function toTemplateDto(t: ContractTemplate): ContractTemplateDto {
  return {
    id: t.id,
    name: t.name,
    provider: t.provider as ContractProviderName,
    providerTemplateId: t.providerTemplateId,
    variableMap: t.variableMap as Record<string, ContractVariable>,
    active: t.active,
    createdAt: t.createdAt.toISOString(),
  };
}

/** Dados de exemplo da prévia do modelo (CTR-01.4). */
const SAMPLE_CUSTOMER = {
  name: 'Cliente de Exemplo Ltda',
  document: '11222333000181',
  personType: 'PJ' as const,
  email: 'contato@exemplo.com.br',
  phone: '11999990000',
  address: { postalCode: '01310100', street: 'Av. Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', state: 'SP' },
};

/** CTR-01: modelos que existem no provedor e o mapeamento campo → variável do catálogo. */
@Injectable()
export class ContractTemplatesService {
  private readonly minChargeCents: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.minChargeCents = config.get('ASAAS_MIN_CHARGE_CENTS', { infer: true });
  }

  async list(active?: boolean): Promise<ContractTemplateDto[]> {
    const rows = await this.prisma.contractTemplate.findMany({
      where: active === undefined ? {} : { active },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toTemplateDto);
  }

  async create(input: TemplateUpsertInput, actor: JwtPayload): Promise<ContractTemplateDto> {
    assertCatalog(input.variableMap);
    const row = await this.prisma.contractTemplate.create({ data: input });
    await this.audit.record({ userId: actor.sub, action: 'contract_template.create', entity: 'contract_template', entityId: row.id, data: { name: row.name } });
    return toTemplateDto(row);
  }

  async update(id: string, input: TemplateUpdateInput, actor: JwtPayload): Promise<ContractTemplateDto> {
    if (input.variableMap) assertCatalog(input.variableMap);
    if (!(await this.prisma.contractTemplate.count({ where: { id } }))) throw templateNotFound();
    const row = await this.prisma.contractTemplate.update({ where: { id }, data: input });
    await this.audit.record({ userId: actor.sub, action: 'contract_template.update', entity: 'contract_template', entityId: id, data: { fields: Object.keys(input) } });
    return toTemplateDto(row);
  }

  /** CTR-01.4: campos resolvidos com cliente e plano de exemplo (ou os informados). */
  async preview(id: string, input: { customerId?: string; chargePlan?: ChargePlan }): Promise<ContractPreviewDto> {
    const template = await this.prisma.contractTemplate.findUnique({ where: { id } });
    if (!template) throw templateNotFound();
    const [settings, customer] = await Promise.all([
      this.prisma.settings.findUnique({ where: { id: 1 } }),
      input.customerId ? this.prisma.customer.findUnique({ where: { id: input.customerId } }) : null,
    ]);
    const today = todayInSaoPaulo();
    const plan: ChargePlan = input.chargePlan ?? {
      items: [{ description: 'Serviço de exemplo', quantity: 1, unitPriceCents: 100_000 }],
      type: 'SINGLE',
      billingType: 'UNDEFINED',
      dueDate: { mode: 'FIXED_DATE', date: addDays(today, settings?.contractChargeDueDays ?? 3) },
      discountCents: 0,
      finePct: settings?.defaultFinePct.toNumber() ?? 2,
      interestPct: settings?.defaultInterestPct.toNumber() ?? 1,
    };
    return resolveContractVariables({
      customer: customer ?? SAMPLE_CUSTOMER,
      plan,
      settings: {
        companyName: settings?.companyName ?? null,
        companyDocument: settings?.companyDocument ?? null,
        companyCity: settings?.companyCity ?? null,
      },
      variableMap: template.variableMap as Record<string, string>,
      today,
      minChargeCents: this.minChargeCents,
    });
  }
}

function assertCatalog(map: Record<string, string>) {
  const unknown = Object.values(map).filter((v) => !(VARIABLE_CATALOG as readonly string[]).includes(v));
  if (unknown.length) throw templateUnknownVariable([...new Set(unknown)]);
}
