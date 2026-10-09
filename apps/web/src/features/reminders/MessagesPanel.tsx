import { useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import {
  REMINDER_KINDS,
  reminderKindLabels,
  VARIABLES_BY_KIND,
  type ReminderKind,
  type ReminderPreviewDto,
  type ReminderTemplateDto,
} from '@financeiro/shared';
import { ErrorState, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/form-errors';
import { useReminderMutations, useReminderTemplates } from './api';

type Editing = { template: ReminderTemplateDto | null; kind: ReminderKind; offsetDays: number | null };

const offsetLabel = (kind: ReminderKind, offset: number | null) =>
  offset === null ? 'geral' : kind === 'BEFORE_DUE' ? `${Math.abs(offset)} dias antes` : `${offset} dias de atraso`;

/** REG-08: uma mensagem por processo (e-mail), com variações por dia em "antes" e "atraso". */
export function MessagesPanel() {
  const templates = useReminderTemplates();
  const [editing, setEditing] = useState<Editing | null>(null);

  if (templates.isPending) return <TableSkeleton rows={8} />;
  if (templates.isError) return <ErrorState error={templates.error} onRetry={() => templates.refetch()} />;
  const email = templates.data.filter((t) => t.channel === 'EMAIL');

  return (
    <>
      <ul className="divide-y rounded-lg border bg-card">
        {REMINDER_KINDS.map((kind) => {
          const rows = email.filter((t) => t.kind === kind).sort((a, b) => (a.offsetDays ?? -999) - (b.offsetDays ?? -999));
          const general = rows.find((t) => t.offsetDays === null);
          return (
            <li key={kind} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{reminderKindLabels[kind]}</p>
                  <p className="text-xs text-muted-foreground">
                    {general ? `${general.active ? 'Ativa' : 'Desativada'}${general.isDefault ? ' · texto padrão' : ' · personalizada'}` : 'Sem mensagem'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(kind === 'BEFORE_DUE' || kind === 'AFTER_DUE') && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ template: null, kind, offsetDays: kind === 'BEFORE_DUE' ? -3 : 1 })}>
                      <Plus aria-hidden />
                      Para um dia
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setEditing({ template: general ?? null, kind, offsetDays: null })}>
                    Editar
                  </Button>
                </div>
              </div>
              {rows
                .filter((t) => t.offsetDays !== null)
                .map((t) => (
                  <button key={t.id} type="button" className="mt-1 block text-xs text-primary hover:underline" onClick={() => setEditing({ template: t, kind, offsetDays: t.offsetDays })}>
                    Mensagem para {offsetLabel(kind, t.offsetDays)} {t.active ? '' : '(desativada)'}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
      {editing && <MessageSheet editing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function MessageSheet({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const m = useReminderMutations();
  const { template, kind } = editing;
  const [offsetDays, setOffsetDays] = useState(editing.offsetDays);
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [active, setActive] = useState(template?.active ?? true);
  const [preview, setPreview] = useState<ReminderPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await m.upsert.mutateAsync({ kind, channel: 'EMAIL', offsetDays, subject, body, active });
      toast.success('Mensagem salva.');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function reset() {
    if (!template) return;
    const t = await m.reset.mutateAsync(template.id);
    setSubject(t.subject ?? '');
    setBody(t.body);
    toast.success('Texto padrão restaurado.');
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{reminderKindLabels[kind]}</SheetTitle>
          <SheetDescription>E-mail · {offsetLabel(kind, offsetDays)}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 text-sm">
          {offsetDays !== null && !template && (
            <label className="grid gap-1.5">
              <span className="font-medium">{kind === 'BEFORE_DUE' ? 'Dias antes do vencimento' : 'Dias de atraso'}</span>
              <Input
                type="number"
                min={1}
                max={60}
                value={Math.abs(offsetDays)}
                onChange={(e) => setOffsetDays(kind === 'BEFORE_DUE' ? -Math.abs(Number(e.target.value)) : Math.abs(Number(e.target.value)))}
                className="tabular w-24"
              />
            </label>
          )}
          <label className="grid gap-1.5"><span className="font-medium">Assunto</span><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="grid gap-1.5"><span className="font-medium">Mensagem</span><Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Variáveis (clique para inserir):</p>
            <div className="flex flex-wrap gap-1">
              {VARIABLES_BY_KIND[kind].map((v) => (
                <button key={v} type="button" className="tabular rounded border bg-muted px-1.5 py-0.5 text-xs hover:bg-accent" onClick={() => setBody(`${body}{${v}}`)}>
                  {`{${v}}`}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} disabled={kind === 'MANUAL'} />
            {kind === 'MANUAL' ? 'Sempre ativa (envio manual)' : 'Ativa'}
          </label>
          <div className="space-y-2 rounded-md border p-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={m.preview.isPending}
              onClick={() => m.preview.mutateAsync({ kind, offsetDays, subject, body }).then(setPreview, (e: unknown) => toast.error(errorMessage(e)))}
            >
              Prévia com a cobrança mais recente
            </Button>
            {preview && (
              <div>
                <p className="font-medium">{preview.subject}</p>
                <p className="mt-1 whitespace-pre-line text-muted-foreground">{preview.text}</p>
              </div>
            )}
          </div>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{error}</p>}
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-t p-4">
          <div className="flex gap-2">
            {template && <Button variant="ghost" onClick={() => void reset()} disabled={m.reset.isPending}>Restaurar padrão</Button>}
            {template && template.offsetDays !== null && (
              <Button variant="ghost" onClick={() => m.remove.mutateAsync(template.id).then(onClose, (e: unknown) => toast.error(errorMessage(e)))}>
                Excluir
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={save} disabled={m.upsert.isPending || !body.trim()}>Salvar</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
