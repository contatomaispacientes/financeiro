import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { CategorySchema } from '@financeiro/shared';
import { ErrorState, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/form-errors';
import { cn } from '@/lib/utils';
import { useCategories, useCategoryMutations } from './api';

/** DSP-04.1: categorias de despesa (ADMIN). Renomear salva ao sair do campo. */
export function CategoriesPanel() {
  const categories = useCategories();
  const { create, update, remove } = useCategoryMutations();
  const [name, setName] = useState('');

  async function run(action: Promise<unknown>, ok?: string) {
    try {
      await action;
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function add() {
    const parsed = CategorySchema.safeParse({ name });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? 'Nome inválido');
    await run(create.mutateAsync(parsed.data), 'Categoria criada.');
    setName('');
  }

  if (categories.isPending) return <TableSkeleton rows={6} />;
  if (categories.isError) return <ErrorState error={categories.error} onRetry={() => categories.refetch()} />;

  return (
    <div className="max-w-xl rounded-lg border bg-card p-4">
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nova categoria" aria-label="Nome da nova categoria" />
        <Button type="submit" disabled={create.isPending}><Plus aria-hidden />Adicionar</Button>
      </form>
      <ul className="divide-y">
        {categories.data.map((c) => (
          <li key={c.id} className={cn('flex items-center gap-3 py-2', !c.active && 'text-muted-foreground')}>
            <Input
              defaultValue={c.name}
              aria-label={`Nome da categoria ${c.name}`}
              className="h-8 flex-1 border-transparent bg-transparent shadow-none hover:border-input focus:border-input"
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== c.name) void run(update.mutateAsync({ id: c.id, input: { name: next } }), 'Categoria renomeada.');
              }}
            />
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={c.active} onCheckedChange={(v) => run(update.mutateAsync({ id: c.id, input: { active: v } }))} />
              {c.active ? 'Ativa' : 'Inativa'}
            </label>
            <Button size="icon-sm" variant="ghost" aria-label={`Excluir ${c.name}`} onClick={() => run(remove.mutateAsync(c.id), 'Categoria excluída.')}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
