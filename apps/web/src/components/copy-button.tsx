import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Copia com um clique (COB-05.3). `label` completa o nome acessível: "Copiar {label}". */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Copiado para a área de transferência.');
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={`Copiar ${label}`} className="shrink-0">
      {copied ? <Check aria-hidden className="text-inflow" /> : <Copy aria-hidden />}
      {copied ? 'Copiado' : 'Copiar'}
    </Button>
  );
}
