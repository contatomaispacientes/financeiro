import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground">
      <p className="tabular">
        {first}–{last} de {total}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
            <ChevronLeft aria-hidden />
            Anterior
          </Button>
          <span className="tabular px-2" aria-current="page">
            {page} / {pages}
          </span>
          <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages}>
            Próxima
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}
    </nav>
  );
}
