import { useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, Copy, LoaderCircle, PlugZap } from 'lucide-react';
import { toast } from 'sonner';
import type { ConnectionTestResult, IntegrationsStatusDto } from '@financeiro/shared';
import { ErrorState, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useIntegrations, useTestAsaas } from './api';
import { WebhookHealthCard } from '../webhooks/WebhookEventsPage';

function Configured({ ok, yes = 'Configurado', no = 'Não configurado' }: { ok: boolean; yes?: string; no?: string }) {
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <span className={cn('inline-flex items-center gap-1.5', ok ? 'text-emerald-800' : 'text-destructive')}>
      <Icon aria-hidden className="size-4" />
      {ok ? yes : no}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 text-sm sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function WebhookUrl({ path }: { path: string }) {
  const url = window.location.origin + path;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <code className="tabular truncate rounded bg-muted px-1.5 py-0.5 text-xs">{url}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Copiar URL do webhook"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(
            () => toast.success('URL copiada.'),
            () => toast.error('Não foi possível copiar.'),
          );
        }}
      >
        <Copy aria-hidden />
      </Button>
    </span>
  );
}

function TestResult({ result, by }: { result: ConnectionTestResult; by?: string | null }) {
  const when = `${formatDateTime(result.testedAt)}${by ? ` por ${by}` : ''}`;
  return result.ok ? (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-emerald-800">
      <CircleCheck aria-hidden className="size-4" />
      Conectado em <span className="tabular">{result.latencyMs} ms</span>
      <span className="text-muted-foreground">· {when}</span>
    </span>
  ) : (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-destructive">
      <CircleX aria-hidden className="size-4" />
      {result.error?.message ?? 'Falhou'}
      <span className="text-muted-foreground">· {when}</span>
    </span>
  );
}

export function IntegrationsPanel() {
  const integrations = useIntegrations(true);
  const testAsaas = useTestAsaas();
  const [testError, setTestError] = useState<string | null>(null);

  if (integrations.isPending) return <TableSkeleton rows={6} />;
  if (integrations.isError) return <ErrorState error={integrations.error} onRetry={() => integrations.refetch()} />;

  const { asaas, contracts, mail }: IntegrationsStatusDto = integrations.data;
  const production = asaas.env === 'production';

  async function runTest() {
    setTestError(null);
    try {
      await testAsaas.mutateAsync();
    } catch (error) {
      setTestError(errorMessage(error));
    }
  }

  return (
    <div className="grid gap-4">
      <WebhookHealthCard />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Asaas</CardTitle>
            <CardDescription>Cobranças, Pix, boleto e cartão.</CardDescription>
          </div>
          <Button variant="outline" onClick={runTest} disabled={testAsaas.isPending}>
            {testAsaas.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <PlugZap aria-hidden />}
            {testAsaas.isPending ? 'Testando…' : 'Testar conexão'}
          </Button>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Ambiente">
              <span className={cn('font-medium', production ? 'text-emerald-800' : 'text-amber-800')}>
                {production ? 'Produção (cobranças reais)' : 'Sandbox (testes)'}
              </span>
            </Row>
            <Row label="Chave de API">
              <Configured ok={asaas.apiKeyConfigured} yes="Configurada" no="Não configurada" />
            </Row>
            <Row label="Token do webhook">
              <Configured ok={asaas.webhookTokenConfigured} />
            </Row>
            <Row label="URL do webhook">
              <WebhookUrl path={asaas.webhookPath} />
              <p className="mt-1 text-xs text-muted-foreground">
                Em desenvolvimento, cadastre no Asaas o endereço do túnel (cloudflared ou ngrok) com este caminho.
              </p>
            </Row>
            <Row label="Último teste">
              <div aria-live="polite">
                {testError ? (
                  <span className="text-destructive">{testError}</span>
                ) : asaas.lastTest ? (
                  <TestResult result={asaas.lastTest} by={asaas.lastTest.testedBy} />
                ) : (
                  <span className="text-muted-foreground">Nunca testado</span>
                )}
              </div>
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contratos</CardTitle>
          <CardDescription>Assinatura eletrônica que dispara a cobrança.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Provedor">
              {contracts.provider === 'clicksign' ? 'Clicksign' : 'Simulado (FakeProvider, só para testes)'}
            </Row>
            {contracts.provider === 'clicksign' && (
              <>
                <Row label="Ambiente">{contracts.env === 'production' ? 'Produção' : 'Sandbox'}</Row>
                <Row label="Token de acesso">
                  <Configured ok={contracts.accessTokenConfigured} />
                </Row>
                <Row label="Segredo HMAC do webhook">
                  <Configured ok={contracts.hmacSecretConfigured} />
                </Row>
              </>
            )}
            <Row label="URL do webhook">
              <WebhookUrl path={contracts.webhookPath} />
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>E-mail</CardTitle>
          <CardDescription>Envio dos lembretes e avisos ao cliente.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Servidor SMTP">
              {mail.configured ? (
                <span className="tabular">
                  {mail.host}:{mail.port}
                </span>
              ) : (
                <Configured ok={false} />
              )}
            </Row>
            <Row label="Remetente">{mail.from}</Row>
          </dl>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Chaves e segredos ficam só nas variáveis de ambiente do servidor e nunca aparecem aqui.
      </p>
    </div>
  );
}
