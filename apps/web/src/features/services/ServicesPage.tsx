import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { PackagePlus, Pencil, Search, Trash2 } from 'lucide-react';
import { can, type ServiceListItemDto, type ServiceListQuery } from '@financeiro/shared';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
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
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/form-errors';
import { formatBRL } from '@/lib/format';
import { ApiError } from '@/lib/http';
import { cn } from '@/lib/utils';
import { useDeleteService, useServices, useToggleService } from './api';
import { ServiceFormSheet } from './ServiceFormSheet';

const STATUS_PARAM: Record<string, ServiceListQuery['status']> = { ativos: 'active', inativos: 'inactive', todos: 'all' };

export function ServicesPage() {
  const { user } = useSession();
  const canEdit = can(user?.role, 'MANAGE_RECORDS');
  const [params, setParams] = useSearchParams();
  const search = params.get('busca') ?? '';
  const statusParam = params.get('situacao') ?? 'ativos';
  const status = STATUS_PARAM[statusParam] ?? 'active';
  const [term, setTerm] = useState(search);
  const [sheet, setSheet] = useState<{ open: boolean; service?: ServiceListItemDto }>({ open: false });
  const [removal, setRemoval] = useState<{ open: boolean; service?: ServiceListItemDto }>({ open: false });
  const services = useServices({ status, search: search || undefined });
  const toggle = useToggleService();
  const remove = useDeleteService();

  // Busca com debounce de 300 ms, refletida na URL (mesmo padrão de clientes).
  useEffect(() => {
    const id = setTimeout(() => {
      if (term.trim() === search) return;
      const next = new URLSearchParams(params);
      if (term.trim()) next.set('busca', term.trim());
      else next.delete('busca');
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(id);
  }, [term, search, params, setParams]);

  function setParam(key: 'situacao', value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  async function setActive(service: ServiceListItemDto, active: boolean) {
    try {
      await toggle.mutateAsync({ id: service.id, active });
      toast.success(active ? `${service.name} ativado.` : `${service.name} desativado.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function confirmRemove(service: ServiceListItemDto) {
    try {
      await remove.mutateAsync(service.id);
      toast.success(`${service.name} excluído.`);
    } catch (error) {
      // SRV-02.2: serviço já vendido não sai; a saída é desativar.
      const inUse = error instanceof ApiError && error.code === 'SERVICE_IN_USE';
      toast.error(errorMessage(error), {
        action: inUse && service.active ? { label: 'Desativar', onClick: () => void setActive(service, false) } : undefined,
      });
    }
  }

  const openCreate = () => setSheet({ open: true });

  return (
    <>
      <PageHeader
        title="Serviços"
        description="O que a empresa vende. O preço do catálogo é só o padrão de cada cobrança."
        actions={
          canEdit && (
            <Button onClick={openCreate}>
              <PackagePlus aria-hidden />
              Novo serviço
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar por nome ou descrição"
            aria-label="Buscar serviços"
            className="pl-9"
          />
        </div>
        <Tabs value={statusParam in STATUS_PARAM ? statusParam : 'ativos'} onValueChange={(v) => setParam('situacao', v === 'ativos' ? null : v)}>
          <TabsList aria-label="Situação">
            <TabsTrigger value="ativos">Ativos</TabsTrigger>
            <TabsTrigger value="inativos">Inativos</TabsTrigger>
            <TabsTrigger value="todos">Todos</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {services.isPending ? (
        <TableSkeleton />
      ) : services.isError ? (
        <ErrorState error={services.error} onRetry={() => services.refetch()} />
      ) : services.data.data.length === 0 ? (
        search ? (
          <EmptyState title="Nenhum serviço encontrado" description="Confira a grafia ou mude o filtro de situação." />
        ) : status === 'inactive' ? (
          <EmptyState title="Nenhum serviço inativo" />
        ) : (
          <EmptyState
            title="Nenhum serviço ainda"
            description="Cadastre o que a empresa vende para montar cobranças e contratos mais rápido."
            action={canEdit && <Button onClick={openCreate}>Novo serviço</Button>}
          />
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serviço</TableHead>
                <TableHead className="text-right">Preço padrão</TableHead>
                <TableHead className="text-right">Vendas</TableHead>
                <TableHead>Situação</TableHead>
                {canEdit && <TableHead className="w-0"><span className="sr-only">Ações</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.data.data.map((s) => (
                <TableRow key={s.id} className={cn(!s.active && 'text-muted-foreground')}>
                  <TableCell className="max-w-md whitespace-normal">
                    <p className="font-medium">{s.name}</p>
                    {s.description && <p className="line-clamp-2 text-xs text-muted-foreground">{s.description}</p>}
                  </TableCell>
                  <TableCell className="tabular text-right">{formatBRL(s.defaultPriceCents)}</TableCell>
                  <TableCell className="tabular text-right">{s.usageCount}</TableCell>
                  <TableCell>
                    {canEdit ? (
                      <label className="inline-flex items-center gap-2 text-sm">
                        <Switch
                          checked={s.active}
                          onCheckedChange={(v) => void setActive(s, v)}
                          aria-label={`Ativar ou desativar ${s.name}`}
                        />
                        {s.active ? 'Ativo' : 'Inativo'}
                      </label>
                    ) : (
                      <span className="text-sm">{s.active ? 'Ativo' : 'Inativo'}</span>
                    )}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" aria-label={`Editar ${s.name}`} onClick={() => setSheet({ open: true, service: s })}>
                          <Pencil aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${s.name}`} onClick={() => setRemoval({ open: true, service: s })}>
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ServiceFormSheet
        service={sheet.service}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
      />

      <AlertDialog open={removal.open} onOpenChange={(open) => setRemoval((current) => ({ ...current, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {removal.service?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Só dá para excluir serviço que nunca entrou em cobrança, assinatura ou contrato. Se já foi vendido, desative-o.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => removal.service && void confirmRemove(removal.service)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
