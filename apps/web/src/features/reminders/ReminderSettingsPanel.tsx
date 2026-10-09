import { useState } from 'react';
import { toast } from 'sonner';
import { LoaderCircle, Play } from 'lucide-react';
import { reminderKindLabels, type SettingsDto } from '@financeiro/shared';
import { useEnvironment } from '@/components/environment-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/lib/form-errors';
import { formatBRL, formatDateTime } from '@/lib/format';
import { useUpdateSettings } from '@/features/settings/api';
import { useReminderMutations, useReminders } from './api';

const statusLabels = { SENT: 'Enviado', SKIPPED: 'Não enviado', FAILED: 'Falhou' } as const;

/** REG-01.1 (dias e canais) e REG-06.2 (envios dos últimos 7 dias). */
export function ReminderSettingsPanel({ settings }: { settings: SettingsDto }) {
  const update = useUpdateSettings();
  const environment = useEnvironment();
  const history = useReminders({ days: 7 });
  const { run } = useReminderMutations();
  const [before, setBefore] = useState(settings.reminderDaysBefore);
  const [onDue, setOnDue] = useState(settings.reminderOnDueDate);
  const [after, setAfter] = useState(settings.reminderDaysAfter.join(', '));
  const [channels, setChannels] = useState(settings.reminderChannels);

  const afterDays = after
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  const afterValid = afterDays.length <= 5 && afterDays.every((d) => Number.isInteger(d) && d >= 1 && d <= 60);
  const toggle = (c: 'ASAAS' | 'EMAIL') => setChannels(channels.includes(c) ? channels.filter((x) => x !== c) : [...channels, c]);

  async function save() {
    try {
      await update.mutateAsync({ reminderDaysBefore: before, reminderOnDueDate: onDue, reminderDaysAfter: [...new Set(afterDays)].sort((a, b) => a - b), reminderChannels: channels });
      toast.success('Régua salva.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const canRun = environment.data && environment.data.asaasEnv !== 'production';

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section className="h-fit space-y-4 rounded-lg border bg-card p-4 text-sm">
        <h2 className="font-medium">Quando avisar</h2>
        <label className="grid gap-1.5">
          <span>Dias antes do vencimento (0 = não avisa)</span>
          <Input type="number" min={0} max={30} value={before} onChange={(e) => setBefore(Number(e.target.value))} className="tabular w-24" />
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={onDue} onCheckedChange={setOnDue} />
          Avisar no dia do vencimento
        </label>
        <label className="grid gap-1.5">
          <span>Dias após o vencimento (até 5, separados por vírgula)</span>
          <Input value={after} onChange={(e) => setAfter(e.target.value)} placeholder="1, 7, 15" aria-invalid={!afterValid} className="tabular" />
          {!afterValid && <span className="text-xs text-destructive">Use até 5 números entre 1 e 60.</span>}
        </label>
        <fieldset className="space-y-2">
          <legend className="mb-1 font-medium">Canais</legend>
          <label className="flex items-start gap-2">
            <Switch checked={channels.includes('ASAAS')} onCheckedChange={() => toggle('ASAAS')} />
            <span>Notificações do Asaas<span className="block text-xs text-muted-foreground">E-mail/SMS do próprio Asaas, com a agenda configurada no painel dele.</span></span>
          </label>
          <label className="flex items-start gap-2">
            <Switch checked={channels.includes('EMAIL')} onCheckedChange={() => toggle('EMAIL')} />
            <span>E-mail da plataforma<span className="block text-xs text-muted-foreground">Usa as mensagens da aba Mensagens.</span></span>
          </label>
          <label className="flex items-start gap-2 opacity-60">
            <Switch checked={false} disabled />
            <span>WhatsApp <span className="text-xs">(em breve)</span></span>
          </label>
        </fieldset>
        <Button onClick={save} disabled={update.isPending || !afterValid || channels.length === 0}>
          {update.isPending && <LoaderCircle aria-hidden className="animate-spin" />}
          Salvar régua
        </Button>
      </section>

      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Últimos 7 dias</h2>
          {canRun && (
            <Button
              size="sm"
              variant="outline"
              disabled={run.isPending}
              onClick={() => run.mutateAsync().then((r) => toast.success(`${r.queued} lembrete(s) na fila.`), (e: unknown) => toast.error(errorMessage(e)))}
            >
              <Play aria-hidden />
              Rodar a régua agora (teste)
            </Button>
          )}
        </div>
        {history.data && (
          <p className="text-sm text-muted-foreground">
            <span className="tabular">{history.data.summary.SENT}</span> enviados · <span className="tabular">{history.data.summary.SKIPPED}</span> não enviados ·{' '}
            <span className="tabular">{history.data.summary.FAILED}</span> com falha
          </p>
        )}
        {history.data && history.data.data.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Mensagem</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular text-sm whitespace-nowrap">{formatDateTime(r.sentAt)}</TableCell>
                    <TableCell className="text-sm">
                      {r.charge.customerName}
                      <span className="tabular block text-xs text-muted-foreground">{formatBRL(r.charge.valueCents)}</span>
                    </TableCell>
                    <TableCell className="text-sm">{reminderKindLabels[r.kind]}</TableCell>
                    <TableCell className="text-sm">
                      {statusLabels[r.status]}
                      {r.error && <span className="block max-w-56 truncate text-xs text-muted-foreground" title={r.error}>{r.error}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">Nenhum envio nos últimos 7 dias.</p>
        )}
      </section>
    </div>
  );
}
