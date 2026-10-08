import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="tabular text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 text-lg font-semibold">Página não encontrada</h1>
      <p className="mt-2 text-sm text-muted-foreground">O endereço pode ter mudado ou não existir.</p>
      <Button asChild variant="outline" className="mt-6">
        <Link to="/">Ir para a visão geral</Link>
      </Button>
    </div>
  );
}
