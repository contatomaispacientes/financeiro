import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { CircleCheck, LoaderCircle, Search, TriangleAlert, UserPlus } from 'lucide-react';
import type { CustomerListItemDto } from '@financeiro/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CustomerFormSheet } from '@/features/customers/CustomerFormSheet';
import { displayDocument } from '@/features/customers/CustomersPage';
import { useCustomerSearch } from './api';
import { useDebouncedValue } from './use-debounced-value';

export type PickedCustomer = Pick<CustomerListItemDto, 'id' | 'name' | 'document' | 'email' | 'asaasCustomerId'>;

/** Aviso do design: o cliente já está no Asaas ou será criado ao gerar (CLI-05). */
function AsaasNotice({ asaasCustomerId }: { asaasCustomerId: string | null }) {
  return asaasCustomerId ? (
    <p className="flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200 ring-inset">
      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        Já existe no Asaas (<span className="tabular">{asaasCustomerId}</span>)
      </span>
    </p>
  ) : (
    <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      Será criado no Asaas ao gerar a cobrança.
    </p>
  );
}

export function CustomerPicker({
  value,
  onChange,
}: {
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer | null) => void;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-3">
      {value ? (
        <>
          <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{value.name}</p>
              <p className="truncate text-sm text-muted-foreground">
                <span className="tabular">{displayDocument(value.document)}</span>
                {value.email && ` · ${value.email}`}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              Trocar cliente
            </Button>
          </div>
          <AsaasNotice asaasCustomerId={value.asaasCustomerId} />
        </>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <CustomerCombobox onSelect={onChange} />
          <Button type="button" variant="outline" onClick={() => setCreating(true)} className="sm:h-9">
            <UserPlus aria-hidden />
            Cadastrar cliente
          </Button>
        </div>
      )}

      <CustomerFormSheet open={creating} onOpenChange={setCreating} onCreated={onChange} />
    </div>
  );
}

/** Combobox com busca no servidor (debounce de 300 ms, como a lista de clientes). */
function CustomerCombobox({ onSelect }: { onSelect: (customer: PickedCustomer) => void }) {
  const listId = useId();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useDebouncedValue(term.trim(), 300);
  const results = useCustomerSearch(search, open);
  const options = (results.data?.data ?? []).filter((c) => !c.archivedAt);
  const activeOption = open ? options[active] : undefined;

  useEffect(() => setActive(0), [search]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && activeOption) {
      event.preventDefault();
      onSelect(activeOption);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative flex-1">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        role="combobox"
        aria-label="Buscar cliente"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
        placeholder="Buscar por nome, CPF ou CNPJ"
        autoComplete="off"
        className="h-9 pl-9"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Clientes"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
        >
          {options.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${c.id}`}
              role="option"
              aria-selected={i === active}
              // mousedown sem preventDefault tiraria o foco do campo e fecharia a lista antes do clique.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => onSelect(c)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm',
                i === active && 'bg-accent text-accent-foreground',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="tabular block text-xs text-muted-foreground">{displayDocument(c.document)}</span>
              </span>
              {c.asaasCustomerId && <span className="shrink-0 text-xs text-inflow">no Asaas</span>}
            </li>
          ))}
          {results.isFetching && options.length === 0 && (
            <li role="presentation" className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              Buscando…
            </li>
          )}
          {!results.isFetching && results.isError && (
            <li role="presentation" className="px-3 py-2 text-sm text-destructive">
              Não foi possível buscar clientes. Tente de novo.
            </li>
          )}
          {!results.isFetching && results.isSuccess && options.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">
              Nenhum cliente encontrado. Use “Cadastrar cliente”.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
