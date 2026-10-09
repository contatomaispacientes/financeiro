import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, CircleAlert, Copy, ExternalLink, FileDown, LoaderCircle, RotateCcw, Send } from 'lucide-react';
import { authMethodLabels, can, variableLabels, type ContractDetailDto } from '@financeiro/shared';
import { ErrorState, TableSkeleton } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { get } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/form-errors';
import { formatBRL, formatDate, formatDateTime } from '@/lib/format';
import { billingTypeLabels, chargeKindLabel, cycleLabels } from '@/features/charges/labels';
import { useContract, useContractMutations, useContractPreview } from './api';

const signerStatus = { PENDING: 'Aguardando', SIGNED: 'Assinou', REFUSED: 'Recusou' } as const;
const eventLabels: Record<string, string> = {
  SIGNER_SIGNED: 'Signatário assinou',
  SIGNER_REFUSED: 'Signatário recusou',
  DOCUMENT_COMPLETED: 'Documento concluído',
  DOCUMENT_EXPIRED: 'Documento expirou',
  DOCUMENT_CANCELED: 'Documento cancelado',
};

function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {actions}
      </div>
      <div className="rounded-lg border bg-card px-4 py-3 text-sm">{children}</div>
    </section>
  );
}

/** CTR-07.2: signatários, plano congelado, variáveis, eventos, PDF e cobrança gerada. */
export function ContractDetailPage() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const contract = useContract(id);
  const m = useContractMutations();
  const [confirm, setConfirm] = useState<'send' | 'cancel' | 'discard' | null>(null);
  const isDraft = contract.data?.status === 'DRAFT';
  const preview = useContractPreview(id, isDraft);

  if (contract.isPending) return <TableSkeleton rows={8} />;
  if (contract.isError) return <ErrorState error={contract.error} onRetry={() => contract.refetch()} />;
  const c: ContractDetailDto = contract.data;
  const canManage = can(user?.role, 'MANAGE_CONTRACTS');
  const open = c.status === 'SENT' || c.status === 'PARTIALLY_SIGNED';
  const plan = c.chargePlan;

  async function run(kind: 'send' | 'cancel' | 'discard') {
    try {
      if (kind === 'send') await m.send.mutateAsync(c.id);
      if (kind === 'discard') await m.discard.mutateAsync(c.id);
      if (kind === 'cancel') await m.cancel.mutateAsync({ id: c.id });
      toast.success({ send: 'Enviado para assinatura.', discard: 'Rascunho descartado.', cancel: 'Contrato cancelado.' }[kind]);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setConfirm(null);
    }
  }

  async function openSignedFile() {
    try {
      const { url } = await get<{ url: string }>(`/contracts/${c.id}/signed-file`);
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const pending = m.send.isPending || m.cancel.isPending || m.discard.isPending;

  return (
    <>
      <Link to="/contratos" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        Contratos
      </Link>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1>
            <StatusBadge kind="contract" status={c.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            <Link to={`/clientes/${c.customer.id}`} className="font-medium text-foreground hover:underline">{c.customer.name}</Link> ·{' '}
            <span className="tabular">{formatBRL(c.totalCents)}</span> · modelo {c.template.name}
            {c.expiresAt && open && <> · assinar até <span className="tabular">{formatDate(c.expiresAt.slice(0, 10))}</span></>}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {isDraft && (
              <>
                <Button variant="outline" onClick={() => setConfirm('discard')} disabled={pending}>Descartar</Button>
                <Button onClick={() => setConfirm('send')} disabled={pending || (preview.data ? preview.data.missing.length > 0 || !preview.data.addressComplete : true)}>
                  <Send aria-hidden />
                  Enviar para assinatura
                </Button>
              </>
            )}
            {open && <Button variant="outline" onClick={() => setConfirm('cancel')} disabled={pending}>Cancelar contrato</Button>}
          </div>
        )}
      </header>

      {c.providerError && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {c.status === 'DRAFT' ? `Falha ao enviar: ${c.providerError}. Enviar de novo retoma de onde parou.` : c.providerError}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {isDraft && (
            <Card title="Prévia do que vai para o modelo">
              {preview.isPending ? (
                <p className="text-muted-foreground">Calculando…</p>
              ) : preview.isError ? (
                <p className="text-destructive">{errorMessage(preview.error)}</p>
              ) : (
                <>
                  {!preview.data.addressComplete && (
                    <p className="mb-2 text-destructive">
                      O cliente precisa de endereço completo. <Link to={`/clientes/${c.customer.id}`} className="underline">Editar cadastro</Link>
                    </p>
                  )}
                  {preview.data.missing.length > 0 && (
                    <p className="mb-2 text-destructive">
                      Falta preencher: {preview.data.missing.map((v) => variableLabels[v]).join(', ')}. Complete o cadastro do cliente ou as Configurações (dados da empresa).
                    </p>
                  )}
                  <dl className="divide-y">
                    {Object.entries(preview.data.fields).map(([field, value]) => (
                      <div key={field} className="grid gap-1 py-1.5 sm:grid-cols-[10rem_1fr]">
                        <dt className="tabular text-xs text-muted-foreground">{field}</dt>
                        <dd className={value ? '' : 'text-destructive'}>{value ?? 'vazio'}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </Card>
          )}

          <Card title="Signatários">
            <ul className="divide-y">
              {c.signers.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{s.name} <span className="text-xs font-normal text-muted-foreground">· {s.role === 'CLIENT' ? 'cliente' : 'empresa'}</span></p>
                    <p className="text-xs text-muted-foreground">
                      {s.email} · {authMethodLabels[s.authMethod]} · {signerStatus[s.status]}
                      {s.signedAt && <> em {formatDateTime(s.signedAt)}</>}
                    </p>
                  </div>
                  {s.signUrl && s.status === 'PENDING' && open && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" asChild>
                        <a href={s.signUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden />Abrir</a>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void navigator.clipboard?.writeText(s.signUrl!).then(() => toast.success('Link copiado.'))}
                      >
                        <Copy aria-hidden />Copiar link
                      </Button>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={m.resend.isPending}
                          onClick={() => m.resend.mutateAsync({ id: c.id, signerId: s.id }).then(() => toast.success('Convite reenviado.'), (e: unknown) => toast.error(errorMessage(e)))}
                        >
                          <RotateCcw aria-hidden />Reenviar
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {c.provider === 'fake' && open && (
              <p className="mt-2 text-xs text-muted-foreground">Provedor simulado: “Abrir” mostra a página de assinatura de cada signatário.</p>
            )}
          </Card>

          {Object.keys(c.variables).length > 0 && (
            <Card title="Variáveis enviadas">
              <dl className="divide-y">
                {Object.entries(c.variables).map(([field, value]) => (
                  <div key={field} className="grid gap-1 py-1.5 sm:grid-cols-[10rem_1fr]">
                    <dt className="tabular text-xs text-muted-foreground">{field}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Cobrança">
            {c.chargeGeneratedAt ? (
              <>
                <p className="mb-2 text-emerald-800">Gerada em {formatDateTime(c.chargeGeneratedAt)}</p>
                {c.subscription && (
                  <p className="mb-2">
                    <Link to={`/assinaturas/${c.subscription.id}`} className="hover:underline">
                      Recorrência {cycleLabels[c.subscription.cycle].toLowerCase()} de {formatBRL(c.subscription.valueCents)}
                    </Link>
                  </p>
                )}
                <ul className="divide-y">
                  {c.charges.map((ch) => (
                    <li key={ch.id} className="flex items-center justify-between gap-2 py-1.5">
                      <Link to={`/cobrancas/${ch.id}`} className="hover:underline">
                        {chargeKindLabel(ch)} · <span className="tabular">{formatDate(ch.dueDate)}</span>
                      </Link>
                      <span className="flex items-center gap-2">
                        <span className="tabular">{formatBRL(ch.valueCents)}</span>
                        <StatusBadge kind="charge" status={ch.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : c.chargeError ? (
              <div className="space-y-2">
                <p className="text-destructive">Não foi possível gerar: {c.chargeError}</p>
                {canManage && (
                  <Button size="sm" disabled={m.generateCharge.isPending} onClick={() => m.generateCharge.mutateAsync(c.id).then(() => toast.success('Gerando de novo…'), (e: unknown) => toast.error(errorMessage(e)))}>
                    {m.generateCharge.isPending && <LoaderCircle aria-hidden className="animate-spin" />}
                    Tentar gerar cobrança
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">
                {c.status === 'SIGNED' ? 'Gerando a cobrança…' : 'É gerada sozinha quando todos assinarem.'}
              </p>
            )}
            <dl className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
              <div>Forma: {billingTypeLabels[plan.billingType]}</div>
              <div>
                Vencimento:{' '}
                {plan.dueDate.mode === 'FIXED_DATE' ? formatDate(plan.dueDate.date) : `${plan.dueDate.days} dias após a assinatura`}
              </div>
              <div>Itens: {plan.items.map((i) => `${i.description} (${i.quantity}x)`).join(' · ')}</div>
            </dl>
          </Card>

          {c.hasSignedFile && (
            <Button variant="outline" className="w-full" onClick={openSignedFile}>
              <FileDown aria-hidden />
              PDF assinado
            </Button>
          )}

          <Card title="Eventos do provedor">
            {c.events.length === 0 ? (
              <p className="text-muted-foreground">Nenhum evento ainda.</p>
            ) : (
              <ol className="space-y-2">
                {c.events.map((e) => (
                  <li key={e.id}>
                    <p className="font-medium">{eventLabels[e.event] ?? e.event}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="tabular">{formatDateTime(e.receivedAt)}</span>
                      {e.result === 'IGNORED_TRANSITION' && ' · ignorado (fora de ordem)'}
                      {!e.processedAt && ' · aguardando processamento'}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'send' ? 'Enviar para assinatura?' : confirm === 'cancel' ? 'Cancelar o contrato?' : 'Descartar o rascunho?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'send'
                ? `${c.signers.length} signatários recebem o convite. Variáveis e plano ficam congelados.`
                : confirm === 'cancel'
                  ? `O documento é cancelado no provedor e ninguém mais consegue assinar. ${c.customer.name}, ${formatBRL(c.totalCents)}.`
                  : 'O rascunho deixa de aparecer como pendente. Não dá para desfazer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                if (confirm) void run(confirm);
              }}
            >
              {pending && <LoaderCircle aria-hidden className="animate-spin" />}
              {confirm === 'send' ? 'Enviar' : confirm === 'cancel' ? 'Cancelar contrato' : 'Descartar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
