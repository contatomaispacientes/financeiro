import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

/** Rota já no menu, tela ainda não implementada: indica a spec que a entrega. */
export function PlaceholderPage({ title, spec }: { title: string; spec: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-card px-6 py-16 text-center">
        <Construction aria-hidden className="size-8 text-muted-foreground" />
        <p className="font-medium">Em construção</p>
        <p className="text-sm text-muted-foreground">Esta tela chega com a spec {spec}.</p>
      </div>
    </>
  );
}
