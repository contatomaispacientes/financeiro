import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Plus, X } from 'lucide-react';
import {
  CONTRACT_PROVIDERS,
  VARIABLE_CATALOG,
  variableLabels,
  type ContractPreviewDto,
  type ContractProviderName,
  type ContractTemplateDto,
} from '@financeiro/shared';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/lib/form-errors';
import { useTemplateMutations, useTemplates } from './api';

const selectClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
const providerLabels: Record<ContractProviderName, string> = { fake: 'Simulado (testes)', clicksign: 'Clicksign' };

/** CTR-01: modelos do provedor e o mapeamento campo → variável (ADMIN). */
export function TemplatesPage() {
  const templates = useTemplates();
  const [editing, setEditing] = useState<ContractTemplateDto | 'new' | null>(null);

  return (
    <>
      <Link to="/contratos" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        Contratos
      </Link>
      <PageHeader
        title="Modelos de contrato"
        description="Cada modelo existe no provedor de assinatura; aqui você diz qual dado do sistema vai em cada campo."
        actions={<Button onClick={() => setEditing('new')}><Plus aria-hidden />Novo modelo</Button>}
      />
      {templates.isPending ? (
        <TableSkeleton />
      ) : templates.isError ? (
        <ErrorState error={templates.error} onRetry={() => templates.refetch()} />
      ) : templates.data.length === 0 ? (
        <EmptyState title="Nenhum modelo" description="Cadastre o modelo que existe no provedor e mapeie os campos." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Provedor</TableHead>
                <TableHead>Campos</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.data.map((t) => (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setEditing(t)}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-sm">{providerLabels[t.provider]}</TableCell>
                  <TableCell className="tabular text-sm">{Object.keys(t.variableMap).length}</TableCell>
                  <TableCell className="text-sm">{t.active ? 'Ativo' : 'Desativado'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <TemplateSheet template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TemplateSheet({ template, onClose }: { template: ContractTemplateDto | null; onClose: () => void }) {
  const m = useTemplateMutations();
  const [name, setName] = useState(template?.name ?? '');
  const [provider, setProvider] = useState<ContractProviderName>(template?.provider ?? 'clicksign');
  const [providerTemplateId, setProviderTemplateId] = useState(template?.providerTemplateId ?? '');
  const [active, setActive] = useState(template?.active ?? true);
  const [rows, setRows] = useState<Array<{ key: number; field: string; variable: string }>>(
    Object.entries(template?.variableMap ?? { nome_cliente: 'cliente.nome' }).map(([field, variable], i) => ({ key: i, field, variable })),
  );
  const [preview, setPreview] = useState<ContractPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const variableMap = Object.fromEntries(rows.filter((r) => r.field.trim()).map((r) => [r.field.trim(), r.variable]));
    const input = { name, provider, providerTemplateId, variableMap, active };
    try {
      if (template) await m.update.mutateAsync({ id: template.id, input });
      else await m.create.mutateAsync(input);
      toast.success('Modelo salvo.');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{template ? 'Editar modelo' : 'Novo modelo'}</SheetTitle>
          <SheetDescription>O ID e os nomes dos campos vêm do modelo cadastrado no provedor.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 text-sm">
          <label className="grid gap-1.5"><span className="font-medium">Nome</span><Input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="font-medium">Provedor</span>
              <select className={selectClass} value={provider} onChange={(e) => setProvider(e.target.value as ContractProviderName)}>
                {CONTRACT_PROVIDERS.map((p) => <option key={p} value={p}>{providerLabels[p]}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5"><span className="font-medium">ID do modelo no provedor</span><Input value={providerTemplateId} onChange={(e) => setProviderTemplateId(e.target.value)} /></label>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium">Campos do modelo</legend>
            {rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input aria-label="Campo no provedor" placeholder="campo_no_modelo" value={r.field} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, field: e.target.value } : x)))} />
                <select aria-label="Variável" className={selectClass} value={r.variable} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, variable: e.target.value } : x)))}>
                  {VARIABLE_CATALOG.map((v) => <option key={v} value={v}>{variableLabels[v]}</option>)}
                </select>
                <Button type="button" variant="ghost" size="icon" aria-label="Remover campo" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><X aria-hidden /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { key: Date.now(), field: '', variable: 'cliente.nome' }])}><Plus aria-hidden />Campo</Button>
          </fieldset>
          <label className="flex items-center gap-2"><Switch checked={active} onCheckedChange={setActive} />Ativo (aparece no Novo contrato)</label>

          {template && (
            <div className="space-y-2 rounded-md border p-3">
              <Button type="button" variant="outline" size="sm" disabled={m.preview.isPending} onClick={() => m.preview.mutateAsync(template.id).then(setPreview, (e: unknown) => toast.error(errorMessage(e)))}>
                Prévia com dados de exemplo
              </Button>
              {preview && (
                <dl className="divide-y">
                  {Object.entries(preview.fields).map(([f, v]) => (
                    <div key={f} className="grid grid-cols-[9rem_1fr] gap-2 py-1"><dt className="tabular text-xs text-muted-foreground">{f}</dt><dd className={v ? '' : 'text-destructive'}>{v ?? 'vazio'}</dd></div>
                  ))}
                </dl>
              )}
            </div>
          )}
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={m.create.isPending || m.update.isPending || !name.trim() || !providerTemplateId.trim()}>Salvar</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
