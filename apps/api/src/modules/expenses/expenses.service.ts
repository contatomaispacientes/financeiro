import { Injectable } from '@nestjs/common';
import {
  clampDay,
  currentMonthInSaoPaulo,
  todayInSaoPaulo,
  type CategoryDto,
  type CategoryInput,
  type ExpenseCreateInput,
  type ExpenseDto,
  type ExpenseListDto,
  type ExpenseListQuery,
  type ExpensePayInput,
  type ExpenseState,
  type ExpenseUpdateInput,
  type PaymentMethod,
  type RecurrenceCreateInput,
  type RecurrenceDto,
  type RecurrenceUpdateInput,
} from '@financeiro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client.js';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import {
  categoryDuplicate,
  categoryInactive,
  categoryInUse,
  categoryNotFound,
  expenseInvalidState,
  expenseNotEditable,
  expenseNotFound,
  recurrenceNotFound,
} from './expenses.errors';

type Tx = Prisma.TransactionClient;
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: { category: true } }>;
type RecurrenceRow = Prisma.ExpenseRecurrenceGetPayload<{ include: { category: true } }>;

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

function lastDayOf(month: string) {
  return clampDay(month, 31);
}

function toExpenseDto(e: ExpenseRow, today: string): ExpenseDto {
  const dueDate = toIso(e.dueDate);
  return {
    id: e.id,
    description: e.description,
    category: { id: e.category.id, name: e.category.name },
    supplier: e.supplier,
    valueCents: e.valueCents,
    dueDate,
    status: e.status,
    late: e.status === 'OPEN' && dueDate < today,
    paidAt: e.paidAt ? toIso(e.paidAt) : null,
    paidValueCents: e.paidValueCents,
    paymentMethod: (e.paymentMethod as PaymentMethod | null) ?? null,
    recurrenceId: e.recurrenceId,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
  };
}

function toRecurrenceDto(r: RecurrenceRow): RecurrenceDto {
  return {
    id: r.id,
    description: r.description,
    category: { id: r.category.id, name: r.category.name },
    supplier: r.supplier,
    valueCents: r.valueCents,
    dayOfMonth: r.dayOfMonth,
    startMonth: r.startMonth,
    endMonth: r.endMonth,
    active: r.active,
    lastGeneratedFor: r.lastGeneratedFor,
  };
}

/** Filtro por situação derivada (DSP-02.3): "a pagar" = OPEN em dia, "atrasada" = OPEN vencida. */
function stateWhere(state: ExpenseState, today: Date): Prisma.ExpenseWhereInput {
  switch (state) {
    case 'open':
      return { status: 'OPEN', dueDate: { gte: today } };
    case 'late':
      return { status: 'OPEN', dueDate: { lt: today } };
    case 'paid':
      return { status: 'PAID' };
    case 'canceled':
      return { status: 'CANCELED' };
  }
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────── Despesas ─────────

  async list(query: ExpenseListQuery): Promise<ExpenseListDto> {
    const todayIso = todayInSaoPaulo();
    const today = toDate(todayIso);
    const where: Prisma.ExpenseWhereInput = {
      ...(query.state?.length ? { OR: query.state.map((s) => stateWhere(s, today)) } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.dueFrom || query.dueTo
        ? { dueDate: { ...(query.dueFrom && { gte: toDate(query.dueFrom) }), ...(query.dueTo && { lte: toDate(query.dueTo) }) } }
        : {}),
      ...(query.search
        ? {
            AND: [
              {
                OR: [
                  { description: { contains: query.search, mode: 'insensitive' } },
                  { supplier: { contains: query.search, mode: 'insensitive' } },
                ],
              },
            ],
          }
        : {}),
    };

    const [rows, total, summary] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: { category: true },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.expense.count({ where }),
      this.summary(todayIso),
    ]);

    return {
      data: rows.map((r) => toExpenseDto(r, todayIso)),
      meta: { page: query.page, pageSize: query.pageSize, total },
      summary,
    };
  }

  /** KPIs do mês corrente, independentes do filtro (design da spec 05). */
  private async summary(todayIso: string) {
    const month = todayIso.slice(0, 7);
    const monthStart = toDate(`${month}-01`);
    const monthEnd = toDate(lastDayOf(month));
    const today = toDate(todayIso);
    const sum = (where: Prisma.ExpenseWhereInput, field: 'valueCents' | 'paidValueCents' = 'valueCents') =>
      this.prisma.expense.aggregate({ where, _sum: { [field]: true }, _count: { _all: true } });

    const [open, late, paidMonth, monthTotal, paid, canceled] = await Promise.all([
      sum({ status: 'OPEN' }),
      sum({ status: 'OPEN', dueDate: { lt: today } }),
      sum({ status: 'PAID', paidAt: { gte: monthStart, lte: monthEnd } }, 'paidValueCents'),
      sum({ status: { not: 'CANCELED' }, dueDate: { gte: monthStart, lte: monthEnd } }),
      this.prisma.expense.count({ where: { status: 'PAID' } }),
      this.prisma.expense.count({ where: { status: 'CANCELED' } }),
    ]);
    const cents = (r: { _sum: Record<string, number | null> }) =>
      Object.values(r._sum)[0] ?? 0;

    return {
      openCents: cents(open),
      lateCents: cents(late),
      paidThisMonthCents: cents(paidMonth),
      monthTotalCents: cents(monthTotal),
      countByState: { open: open._count._all - late._count._all, late: late._count._all, paid, canceled },
    };
  }

  async create(input: ExpenseCreateInput, actor: JwtPayload): Promise<ExpenseDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertActiveCategory(tx, input.categoryId);
      let recurrenceId: string | null = null;
      let referenceMonth: string | null = null;

      // DSP-03.6: "repetir todo mês" cria a recorrência e a despesa do mês juntas.
      if (input.repeatMonthly) {
        referenceMonth = input.dueDate.slice(0, 7);
        const rec = await tx.expenseRecurrence.create({
          data: {
            description: input.description,
            categoryId: input.categoryId,
            supplier: input.supplier ?? null,
            valueCents: input.valueCents,
            dayOfMonth: Number(input.dueDate.slice(8, 10)),
            startMonth: referenceMonth,
            lastGeneratedFor: referenceMonth,
          },
        });
        recurrenceId = rec.id;
      }

      const row = await tx.expense.create({
        data: {
          description: input.description,
          categoryId: input.categoryId,
          supplier: input.supplier ?? null,
          valueCents: input.valueCents,
          dueDate: toDate(input.dueDate),
          notes: input.notes ?? null,
          recurrenceId,
          referenceMonth,
          createdById: actor.sub,
        },
        include: { category: true },
      });
      await this.audit.record(
        { userId: actor.sub, action: 'expense.create', entity: 'expense', entityId: row.id, data: { description: row.description, valueCents: row.valueCents, repeatMonthly: input.repeatMonthly } },
        tx,
      );
      return toExpenseDto(row, todayInSaoPaulo());
    });
  }

  async update(id: string, input: ExpenseUpdateInput, actor: JwtPayload): Promise<ExpenseDto> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.expense.findUnique({ where: { id } });
      if (!current) throw expenseNotFound();
      const onlyNotes = Object.keys(input).every((k) => k === 'notes');
      if (current.status !== 'OPEN' && !onlyNotes) throw expenseNotEditable();
      if (input.categoryId && input.categoryId !== current.categoryId) await this.assertActiveCategory(tx, input.categoryId);

      const row = await tx.expense.update({
        where: { id },
        data: {
          ...(input.description !== undefined && { description: input.description }),
          ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
          ...(input.supplier !== undefined && { supplier: input.supplier }),
          ...(input.valueCents !== undefined && { valueCents: input.valueCents }),
          ...(input.dueDate !== undefined && { dueDate: toDate(input.dueDate) }),
          ...(input.notes !== undefined && { notes: input.notes }),
        },
        include: { category: true },
      });
      await this.audit.record({ userId: actor.sub, action: 'expense.update', entity: 'expense', entityId: id, data: { fields: Object.keys(input) } }, tx);
      return toExpenseDto(row, todayInSaoPaulo());
    });
  }

  pay(id: string, input: ExpensePayInput, actor: JwtPayload) {
    return this.transition(id, 'OPEN', 'pagar', 'expense.pay', actor, (e) => ({
      status: 'PAID',
      paidAt: toDate(input.paidAt ?? todayInSaoPaulo()),
      paidValueCents: input.paidValueCents ?? e.valueCents,
      paymentMethod: input.paymentMethod,
    }));
  }

  unpay(id: string, actor: JwtPayload) {
    return this.transition(id, 'PAID', 'desfazer o pagamento de', 'expense.unpay', actor, () => ({
      status: 'OPEN',
      paidAt: null,
      paidValueCents: null,
      paymentMethod: null,
    }));
  }

  cancel(id: string, actor: JwtPayload) {
    return this.transition(id, 'OPEN', 'cancelar', 'expense.cancel', actor, () => ({ status: 'CANCELED' }));
  }

  private async transition(
    id: string,
    from: 'OPEN' | 'PAID',
    verb: string,
    action: string,
    actor: JwtPayload,
    data: (e: { valueCents: number }) => Prisma.ExpenseUpdateInput,
  ): Promise<ExpenseDto> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.expense.findUnique({ where: { id } });
      if (!current) throw expenseNotFound();
      // Atualização condicional: dois cliques simultâneos não pagam duas vezes.
      const { count } = await tx.expense.updateMany({ where: { id, status: from }, data: data(current) as Prisma.ExpenseUpdateManyMutationInput });
      if (count === 0) throw expenseInvalidState(verb);
      const row = await tx.expense.findUniqueOrThrow({ where: { id }, include: { category: true } });
      await this.audit.record(
        { userId: actor.sub, action, entity: 'expense', entityId: id, data: { valueCents: row.valueCents, paidValueCents: row.paidValueCents, paymentMethod: row.paymentMethod } },
        tx,
      );
      return toExpenseDto(row, todayInSaoPaulo());
    });
  }

  // ───────── Recorrências ─────────

  async listRecurrences(): Promise<RecurrenceDto[]> {
    const rows = await this.prisma.expenseRecurrence.findMany({
      include: { category: true },
      orderBy: [{ active: 'desc' }, { description: 'asc' }],
    });
    return rows.map(toRecurrenceDto);
  }

  async createRecurrence(input: RecurrenceCreateInput, actor: JwtPayload): Promise<RecurrenceDto> {
    const rec = await this.prisma.$transaction(async (tx) => {
      await this.assertActiveCategory(tx, input.categoryId);
      const row = await tx.expenseRecurrence.create({
        data: {
          description: input.description,
          categoryId: input.categoryId,
          supplier: input.supplier ?? null,
          valueCents: input.valueCents,
          dayOfMonth: input.dayOfMonth,
          startMonth: input.startMonth,
          endMonth: input.endMonth ?? null,
        },
      });
      await this.audit.record({ userId: actor.sub, action: 'expense_recurrence.create', entity: 'expense_recurrence', entityId: row.id }, tx);
      return row;
    });
    // DSP-03.3: gera já a despesa do mês corrente se a recorrência começou.
    await this.generateFor(currentMonthInSaoPaulo(), rec.id);
    return toRecurrenceDto(await this.prisma.expenseRecurrence.findUniqueOrThrow({ where: { id: rec.id }, include: { category: true } }));
  }

  /** DSP-03.4/03.5: muda as próximas gerações; despesas já geradas ficam como estão. */
  async updateRecurrence(id: string, input: RecurrenceUpdateInput, actor: JwtPayload): Promise<RecurrenceDto> {
    const exists = await this.prisma.expenseRecurrence.findUnique({ where: { id } });
    if (!exists) throw recurrenceNotFound();
    if (input.categoryId && input.categoryId !== exists.categoryId) await this.assertActiveCategory(this.prisma, input.categoryId);
    const row = await this.prisma.expenseRecurrence.update({
      where: { id },
      data: {
        ...(input.description !== undefined && { description: input.description }),
        ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
        ...(input.supplier !== undefined && { supplier: input.supplier }),
        ...(input.valueCents !== undefined && { valueCents: input.valueCents }),
        ...(input.dayOfMonth !== undefined && { dayOfMonth: input.dayOfMonth }),
        ...(input.startMonth !== undefined && { startMonth: input.startMonth }),
        ...(input.endMonth !== undefined && { endMonth: input.endMonth }),
        ...(input.active !== undefined && { active: input.active }),
      },
      include: { category: true },
    });
    await this.audit.record({ userId: actor.sub, action: 'expense_recurrence.update', entity: 'expense_recurrence', entityId: id, data: { fields: Object.keys(input) } });
    return toRecurrenceDto(row);
  }

  /**
   * DSP-03.2: gera a despesa do mês de cada recorrência ativa, uma única vez
   * (`@@unique([recurrenceId, referenceMonth])` + skipDuplicates).
   */
  async generateFor(month: string, onlyRecurrenceId?: string): Promise<number> {
    const recurrences = await this.prisma.expenseRecurrence.findMany({
      where: {
        active: true,
        startMonth: { lte: month },
        OR: [{ endMonth: null }, { endMonth: { gte: month } }],
        ...(onlyRecurrenceId ? { id: onlyRecurrenceId } : {}),
      },
    });
    if (!recurrences.length) return 0;
    const { count } = await this.prisma.expense.createMany({
      data: recurrences.map((r) => ({
        description: r.description,
        categoryId: r.categoryId,
        supplier: r.supplier,
        valueCents: r.valueCents,
        dueDate: toDate(clampDay(month, r.dayOfMonth)),
        recurrenceId: r.id,
        referenceMonth: month,
      })),
      skipDuplicates: true,
    });
    await this.prisma.expenseRecurrence.updateMany({
      where: { id: { in: recurrences.map((r) => r.id) } },
      data: { lastGeneratedFor: month },
    });
    return count;
  }

  // ───────── Categorias ─────────

  async listCategories(): Promise<CategoryDto[]> {
    return this.prisma.expenseCategory.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }], select: { id: true, name: true, active: true } });
  }

  async createCategory(input: CategoryInput, actor: JwtPayload): Promise<CategoryDto> {
    try {
      const row = await this.prisma.expenseCategory.create({ data: { name: input.name, active: input.active ?? true }, select: { id: true, name: true, active: true } });
      await this.audit.record({ userId: actor.sub, action: 'expense_category.create', entity: 'expense_category', entityId: row.id, data: { name: row.name } });
      return row;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw categoryDuplicate();
      throw error;
    }
  }

  async updateCategory(id: string, input: Partial<CategoryInput>, actor: JwtPayload): Promise<CategoryDto> {
    try {
      const row = await this.prisma.expenseCategory.update({ where: { id }, data: input, select: { id: true, name: true, active: true } });
      await this.audit.record({ userId: actor.sub, action: 'expense_category.update', entity: 'expense_category', entityId: id, data: input });
      return row;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw categoryDuplicate();
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw categoryNotFound();
      throw error;
    }
  }

  async deleteCategory(id: string, actor: JwtPayload): Promise<void> {
    const [expenses, recurrences] = await Promise.all([
      this.prisma.expense.count({ where: { categoryId: id } }),
      this.prisma.expenseRecurrence.count({ where: { categoryId: id } }),
    ]);
    if (expenses + recurrences > 0) throw categoryInUse();
    const { count } = await this.prisma.expenseCategory.deleteMany({ where: { id } });
    if (count === 0) throw categoryNotFound();
    await this.audit.record({ userId: actor.sub, action: 'expense_category.delete', entity: 'expense_category', entityId: id });
  }

  private async assertActiveCategory(db: Tx | PrismaService, categoryId: string) {
    const category = await db.expenseCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw categoryNotFound();
    if (!category.active) throw categoryInactive();
  }
}
