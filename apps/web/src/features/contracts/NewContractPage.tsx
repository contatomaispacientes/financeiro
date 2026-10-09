import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { LoaderCircle, Plus, TriangleAlert, X } from 'lucide-react';
import {
  AUTH_METHODS,
  authMethodLabels,
  calculatePlan,
  isAddressComplete,
  todayInSaoPaulo,
  type AuthMethod,
  type ChargePlan,
  type ChargePlanInput,
  type SignerInput,
} from '@financeiro/shared';
import { useEnvironment } from '@/components/environment-badge';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/form-errors';
import { formatBRL, formatDate } from '@/lib/format';
import { usePreselectedCustomer } from '@/features/charges/api';
import type { PickedCustomer } from '@/features/charges/CustomerPicker';
import { billingTypeLabels, cycleLabels } from '@/features/charges/labels';
import { useSettings } from '@/features/settings/api';
import { useContractMutations, useTemplates } from './api';

export interface NewContractState {
  customer: PickedCustomer;
  plan: ChargePlanInput;
}

interface SignerRow {
  key: number;
  role: 'CLIENT' | 'COMPANY';
  name: string;
  email: string;
  phone: string;
  authMethod: AuthMethod;
}

const selectClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

/** CTR-02, passo 2: modelo, regra de vencimento, signatários e validade. O plano vem da Nova Cobrança. */
export function NewContractPage() {
  const state = useLocation().state as NewContractState | null;
  if (!state?.customer || !state.plan) {
    return (
      <>
        <PageHeader title="Novo contrato" />
        <EmptyState
          title="Comece pelo cliente e pelas condições"
          description="O contrato usa o mesmo plano da Nova cobrança. Monte-o lá e clique em “Continuar para o contrato”."
          action={
            <Button asChild>
              <Link to="/cobrancas/nova?contrato=1">Montar o plano</Link>
            </Button>
          }
        />
      </>
    );
  }
  return <ContractForm initial={state} />;
}

function ContractForm({ initial }: { initial: NewContractState }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const environment = useEnvironment();
  const customer = usePreselectedCustomer(initial.customer.id);
  const templates = useTemplates(true);
  const { create } = useContractMutations();
  const [today] = useState(todayInSaoPaulo);

  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState(`Contrato de prestação de serviços — ${initial.customer.name}`);
  const [dueMode, setDueMode] = useState<'AFTER' | 'FIXED'>('AFTER');
  const [dueDays, setDueDays] = useState<number | null>(null);
  const [validDays, setValidDays] = useState(15);
  const [signers, setSigners] = useState<SignerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (settings.isPending || customer.isPending || templates.isPending || environment.isPending) return <TableSkeleton rows={8} />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
  if (customer.isError) return <ErrorState error={customer.error} onRetry={() => customer.refetch()} />;

  const s = settings.data;
  const c = customer.data;
  const days = dueDays ?? s.contractChargeDueDays;
  const rows: SignerRow[] = signers ?? [
    { key: 1, role: 'CLIENT', name: c.name, email: c.email ?? '', phone: c.phone ?? '', authMethod: 'email' },
    { key: 2, role: 'COMPANY', name: s.companySignerName ?? '', email: s.companySignerEmail ?? '', phone: s.companySignerPhone ?? '', authMethod: 'email' },
  ];
  const setRows = (next: SignerRow[]) => setSigners(next);
  const update = (key: number, patch: Partial<SignerRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const fixedDate = initial.plan.dueDate.mode === 'FIXED_DATE' ? initial.plan.dueDate.date : today;
  const plan: ChargePlanInput = {
    ...initial.plan,
    dueDate: dueMode === 'AFTER' ? { mode: 'DAYS_AFTER_SIGNATURE', days } : { mode: 'FIXED_DATE', date: fixedDate },
  };
  const calc = calculatePlan(plan as ChargePlan, { today, signedAt: new Date(), minChargeCents: environment.data?.minChargeCents ?? 500 });
  const addressOk = isAddressComplete(c.address);

  async function save() {
    setError(null);
    try {
      const contract = await create.mutateAsync({
        customerId: c.id,
        templateId,
        title,
        chargePlan: plan,
        validDays,
        signers: rows.map(
          (r, i): SignerInput => ({
            role: r.role,
            name: r.name,
            email: r.email,
            phone: r.phone || undefined,
            authMethod: r.authMethod,
            signOrder: i + 1,
          }),
        ),
      });
      toast.success('Rascunho salvo. Confira a prévia e envie para assinatura.');
      navigate(`/contratos/${contract.id}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader title="Novo contrato" description="Passo 2 de 2: modelo, vencimento e quem assina." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-6">
          {!addressOk && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {c.name} não tem endereço completo, e o envio fica bloqueado até corrigir.{' '}
                <Link to={`/clientes/${c.id}`} className="font-medium underline">Editar o cadastro</Link>
              </span>
            </p>
          )}

          <section className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
            <h2 className="font-medium">Contrato</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Modelo</span>
                <select className={selectClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">Escolha o modelo</option>
                  {templates.data?.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {templates.data?.length === 0 && <span className="text-xs text-destructive">Nenhum modelo ativo. Um ADMIN cadastra em Contratos › Modelos.</span>}
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Validade para assinar (dias)</span>
                <Input type="number" min={1} max={90} value={validDays} onChange={(e) => setValidDays(Number(e.target.value) || 1)} className="tabular" />
              </label>
              <label className="grid gap-1.5 text-sm sm:col-span-2">
                <span className="font-medium">Título</span>
                <Input value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
              </label>
            </div>
          </section>

          <section className="space-y-3 rounded-lg border bg-card p-4 sm:p-5">
            <h2 className="font-medium">Vencimento da cobrança (CTR-02.2)</h2>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="due" checked={dueMode === 'AFTER'} onChange={() => setDueMode('AFTER')} />
              <Input type="number" min={0} max={60} value={days} onChange={(e) => setDueDays(Number(e.target.value))} className="tabular h-8 w-20" aria-label="Dias após a assinatura" />
              dias após a assinatura
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="due" checked={dueMode === 'FIXED'} onChange={() => setDueMode('FIXED')} />
              Data fixa: <span className="tabular">{formatDate(fixedDate)}</span>
              <span className="text-muted-foreground">(se já tiver passado na assinatura, vira hoje + {s.contractChargeDueDays} dias)</span>
            </label>
          </section>

          <section className="space-y-3 rounded-lg border bg-card p-4 sm:p-5">
            <h2 className="font-medium">Signatários</h2>
            <p className="text-sm text-muted-foreground">O cliente e ao menos um representante da empresa. WhatsApp e SMS pedem celular.</p>
            <ol className="space-y-3">
              {rows.map((r, i) => (
                <li key={r.key} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_9rem_8rem_auto]">
                  <p className="text-xs font-medium text-muted-foreground sm:col-span-5">
                    {i + 1}. {r.role === 'CLIENT' ? 'Cliente' : 'Empresa'}
                  </p>
                  <Input aria-label={`Nome do signatário ${i + 1}`} placeholder="Nome" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} />
                  <Input aria-label={`E-mail do signatário ${i + 1}`} placeholder="E-mail" type="email" value={r.email} onChange={(e) => update(r.key, { email: e.target.value })} />
                  <Input aria-label={`Celular do signatário ${i + 1}`} placeholder="Celular" value={r.phone} onChange={(e) => update(r.key, { phone: e.target.value })} />
                  <select aria-label={`Autenticação do signatário ${i + 1}`} className={selectClass} value={r.authMethod} onChange={(e) => update(r.key, { authMethod: e.target.value as AuthMethod })}>
                    {AUTH_METHODS.map((m) => <option key={m} value={m}>{authMethodLabels[m]}</option>)}
                  </select>
                  {r.role === 'COMPANY' && rows.filter((x) => x.role === 'COMPANY').length > 1 ? (
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remover signatário ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                      <X aria-hidden />
                    </Button>
                  ) : <span />}
                </li>
              ))}
            </ol>
            {rows.length < 6 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { key: Date.now(), role: 'COMPANY', name: '', email: '', phone: '', authMethod: 'email' }])}>
                <Plus aria-hidden />
                Outro representante da empresa
              </Button>
            )}
          </section>
        </div>

        <aside className="space-y-4 rounded-lg border bg-card p-4 sm:p-5 lg:sticky lg:top-6">
          <h2 className="font-medium">Resumo</h2>
          <p className="text-sm text-muted-foreground">{c.name}</p>
          {calc.ok ? (
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Total</dt><dd className="tabular text-lg font-semibold">{formatBRL(calc.value.totalCents)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Forma</dt><dd>{billingTypeLabels[plan.billingType]}</dd></div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Condição</dt>
                <dd className="text-right">
                  {plan.type === 'INSTALLMENT'
                    ? `${calc.value.installments.length}× de ${formatBRL(calc.value.installments[0]!.valueCents)}`
                    : plan.type === 'RECURRING'
                      ? `${cycleLabels[plan.cycle!]}`
                      : 'Pagamento único'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Vencimento</dt>
                <dd className="text-right">{dueMode === 'AFTER' ? `${days} dias após assinar` : formatDate(fixedDate)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-destructive">{calc.error.message}</p>
          )}
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button className="w-full" disabled={!templateId || !calc.ok || create.isPending} onClick={save}>
            {create.isPending && <LoaderCircle aria-hidden className="animate-spin" />}
            Salvar rascunho
          </Button>
          <p className="text-xs text-muted-foreground">No rascunho você confere a prévia das variáveis e envia para assinatura.</p>
        </aside>
      </div>
    </>
  );
}
