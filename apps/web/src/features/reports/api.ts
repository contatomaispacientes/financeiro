import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AgingDto, CashflowDto, CategoryBreakdown, DashboardDto, StatementEntry } from '@financeiro/shared';
import { get } from '@/lib/api';
import { session } from '@/lib/auth';
import { buildUrl, type Query } from '@/lib/http';

export function useDashboard(month: string) {
  return useQuery({
    queryKey: ['dashboard', month],
    queryFn: () => get<DashboardDto>('/reports/dashboard', { month }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useCashflow(from: string, to: string) {
  return useQuery({
    queryKey: ['cashflow', from, to],
    queryFn: () => get<CashflowDto>('/reports/cashflow', { from, to }),
    placeholderData: keepPreviousData,
  });
}

export function useByCategory(month: string) {
  return useQuery({ queryKey: ['cashflow', 'category', month], queryFn: () => get<CategoryBreakdown[]>('/reports/expenses-by-category', { month }) });
}

export function useStatement(month: string) {
  return useQuery({ queryKey: ['cashflow', 'statement', month], queryFn: () => get<StatementEntry[]>('/reports/statement', { month }) });
}

export function useAging() {
  return useQuery({ queryKey: ['cashflow', 'aging'], queryFn: () => get<AgingDto>('/reports/aging') });
}

/** FLX-06.1: baixa o CSV com o token da sessão (o link direto não levaria o Authorization). */
export async function downloadCsv(path: string, query: Query, filename: string) {
  const res = await fetch(buildUrl(path, query), {
    headers: { Authorization: `Bearer ${session.getAccessToken() ?? ''}` },
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Não foi possível exportar.');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
