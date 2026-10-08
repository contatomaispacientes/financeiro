import { z } from '../zod.js';

const IsoDate = z.iso.date({ error: 'Data inválida' });
const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'Mês inválido (AAAA-MM)' });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const PAYMENT_METHODS = ['PIX', 'BOLETO', 'CARTAO', 'TRANSFERENCIA', 'DINHEIRO', 'DEBITO_AUTOMATICO'] as const;
export const PaymentMethodEnum = z.enum(PAYMENT_METHODS, { error: 'Escolha a forma de pagamento' });
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CARTAO: 'Cartão',
  TRANSFERENCIA: 'Transferência',
  DINHEIRO: 'Dinheiro',
  DEBITO_AUTOMATICO: 'Débito automático',
};

const ExpenseBase = z.object({
  description: z.string().trim().min(2, { error: 'Descrição com no mínimo 2 caracteres' }).max(120),
  categoryId: z.uuid({ error: 'Escolha a categoria' }),
  supplier: optionalText(120),
  valueCents: z.number().int().positive({ error: 'Informe um valor maior que zero' }),
  dueDate: IsoDate,
  notes: optionalText(2000),
});

export const ExpenseCreateSchema = ExpenseBase.extend({ repeatMonthly: z.boolean().default(false) });
export type ExpenseCreateInput = z.infer<typeof ExpenseCreateSchema>;

export const ExpenseUpdateSchema = ExpenseBase.partial().refine((v) => Object.keys(v).length > 0, {
  error: 'Informe ao menos um campo',
});
export type ExpenseUpdateInput = z.infer<typeof ExpenseUpdateSchema>;

export const ExpensePaySchema = z.object({
  paidAt: IsoDate.optional(),
  paidValueCents: z.number().int().positive().optional(),
  paymentMethod: PaymentMethodEnum,
});
export type ExpensePayInput = z.infer<typeof ExpensePaySchema>;

export const EXPENSE_STATES = ['open', 'late', 'paid', 'canceled'] as const;
export type ExpenseState = (typeof EXPENSE_STATES)[number];

export const ExpenseListQuerySchema = z.object({
  state: z
    .union([z.enum(EXPENSE_STATES), z.array(z.enum(EXPENSE_STATES))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  categoryId: z.uuid().optional(),
  dueFrom: IsoDate.optional(),
  dueTo: IsoDate.optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ExpenseListQuery = z.infer<typeof ExpenseListQuerySchema>;

const RecurrenceBase = z.object({
  description: z.string().trim().min(2, { error: 'Descrição com no mínimo 2 caracteres' }).max(120),
  categoryId: z.uuid({ error: 'Escolha a categoria' }),
  supplier: optionalText(120),
  valueCents: z.number().int().positive({ error: 'Informe um valor maior que zero' }),
  dayOfMonth: z.number().int().min(1).max(31, { error: 'Dia entre 1 e 31' }),
  startMonth: YearMonth,
  endMonth: YearMonth.nullable().optional(),
  active: z.boolean(),
});

export const RecurrenceCreateSchema = RecurrenceBase.omit({ active: true }).refine(
  (r) => !r.endMonth || r.endMonth >= r.startMonth,
  { error: 'O mês final deve ser igual ou posterior ao inicial', path: ['endMonth'] },
);
export type RecurrenceCreateInput = z.infer<typeof RecurrenceCreateSchema>;

export const RecurrenceUpdateSchema = RecurrenceBase.partial().refine((v) => Object.keys(v).length > 0, {
  error: 'Informe ao menos um campo',
});
export type RecurrenceUpdateInput = z.infer<typeof RecurrenceUpdateSchema>;

export const CategorySchema = z.object({
  name: z.string().trim().min(2, { error: 'Nome com no mínimo 2 caracteres' }).max(60),
  active: z.boolean().optional(),
});
export const CategoryUpdateSchema = CategorySchema.partial();
export type CategoryInput = z.infer<typeof CategorySchema>;

export interface CategoryDto {
  id: string;
  name: string;
  active: boolean;
}

export interface ExpenseDto {
  id: string;
  description: string;
  category: { id: string; name: string };
  supplier: string | null;
  valueCents: number;
  dueDate: string;
  status: 'OPEN' | 'PAID' | 'CANCELED';
  /** DSP-02.3: OPEN com vencimento antes de hoje (derivado). */
  late: boolean;
  paidAt: string | null;
  paidValueCents: number | null;
  paymentMethod: PaymentMethod | null;
  recurrenceId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ExpenseSummary {
  /** Todas as despesas em aberto (inclui atrasadas). */
  openCents: number;
  lateCents: number;
  /** Pago no mês corrente (por data de pagamento). */
  paidThisMonthCents: number;
  /** Total com vencimento no mês corrente (exceto canceladas). */
  monthTotalCents: number;
  countByState: Record<ExpenseState, number>;
}

export interface ExpenseListDto {
  data: ExpenseDto[];
  meta: { page: number; pageSize: number; total: number };
  summary: ExpenseSummary;
}

export interface RecurrenceDto {
  id: string;
  description: string;
  category: { id: string; name: string };
  supplier: string | null;
  valueCents: number;
  dayOfMonth: number;
  startMonth: string;
  endMonth: string | null;
  active: boolean;
  lastGeneratedFor: string | null;
}
