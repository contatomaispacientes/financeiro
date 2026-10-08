import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IntegrationsStatusDto, SettingsDto } from '@financeiro/shared';
import { routes } from '@/router';
import { apiUrl, server } from '@/test/server';
import { mockEnvironment, renderRoutes, signIn } from '@/test/render';
import { settingsDto } from '@/test/fixtures';

function integrations(overrides: Partial<IntegrationsStatusDto['asaas']> = {}): IntegrationsStatusDto {
  return {
    asaas: {
      env: 'sandbox',
      apiKeyConfigured: true,
      webhookTokenConfigured: false,
      webhookPath: '/api/v1/webhooks/asaas',
      lastTest: null,
      ...overrides,
    },
    contracts: {
      provider: 'fake',
      env: 'sandbox',
      accessTokenConfigured: false,
      hmacSecretConfigured: false,
      webhookPath: '/api/v1/webhooks/contracts/fake',
    },
    mail: { configured: true, host: 'localhost', port: 1025, from: 'financeiro@local.test' },
  };
}

function mockSettingsApi(initial = settingsDto()) {
  let current: SettingsDto = initial;
  const patches: unknown[] = [];
  server.use(
    http.get(apiUrl('/settings'), () => HttpResponse.json(current)),
    http.patch(apiUrl('/settings'), async ({ request }) => {
      const body = (await request.json()) as Partial<SettingsDto>;
      patches.push(body);
      current = { ...current, ...body };
      return HttpResponse.json(current);
    }),
  );
  return patches;
}

describe('[FND-04] Configurações', () => {
  beforeEach(() => mockEnvironment());

  describe('[FND-04.1] aba Geral', () => {
    it('ADMIN altera e salva; documento vai só com dígitos', async () => {
      signIn('ADMIN');
      const patches = mockSettingsApi();
      renderRoutes(routes, '/configuracoes');

      const fine = await screen.findByLabelText('Multa por atraso');
      expect(fine).toHaveValue(2);
      const save = screen.getByRole('button', { name: 'Salvar alterações' });
      expect(save).toBeDisabled();

      await userEvent.clear(fine);
      await userEvent.type(fine, '2.5');
      await userEvent.type(screen.getByLabelText('CPF ou CNPJ'), '11.222.333/0001-81');
      await userEvent.type(screen.getByLabelText('Celular do signatário'), '(11) 99999-0000');
      expect(save).toBeEnabled();
      await userEvent.click(save);

      await waitFor(() => expect(patches).toHaveLength(1));
      expect(patches[0]).toMatchObject({
        defaultFinePct: 2.5,
        companyDocument: '11222333000181',
        companySignerPhone: '11999990000',
        companySignerEmail: null,
        companyName: 'Minha Empresa',
      });
      expect(await screen.findByText('Configurações salvas.')).toBeInTheDocument();
      await waitFor(() => expect(save).toBeDisabled());
    });

    it('valida com o mesmo schema da API, em português, sem enviar', async () => {
      signIn('ADMIN');
      const patches = mockSettingsApi();
      renderRoutes(routes, '/configuracoes');

      const fine = await screen.findByLabelText('Multa por atraso');
      await userEvent.clear(fine);
      await userEvent.type(fine, '11');
      await userEvent.type(screen.getByLabelText('CPF ou CNPJ'), '11222333000182');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

      expect(await screen.findByText('CPF ou CNPJ inválido')).toBeInTheDocument();
      expect(screen.getByText(/Grande demais/)).toBeInTheDocument();
      expect(fine).toHaveAttribute('aria-invalid', 'true');
      expect(patches).toHaveLength(0);
    });

    it('"Descartar" volta aos valores salvos', async () => {
      signIn('ADMIN');
      mockSettingsApi();
      renderRoutes(routes, '/configuracoes');

      const name = await screen.findByLabelText('Nome da empresa');
      await userEvent.clear(name);
      await userEvent.type(name, 'Outra');
      await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
      expect(name).toHaveValue('Minha Empresa');
    });

    it.each(['FINANCEIRO', 'LEITURA'] as const)('%s vê os valores, mas não altera', async (role) => {
      signIn(role);
      mockSettingsApi();
      renderRoutes(routes, '/configuracoes');

      expect(await screen.findByLabelText('Nome da empresa')).toBeDisabled();
      expect(screen.getByLabelText('Multa por atraso')).toBeDisabled();
      expect(screen.getByText('Somente administradores alteram as configurações.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Salvar alterações' })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Integrações' })).not.toBeInTheDocument();
    });
  });

  describe('[FND-04.2] aba Integrações (ADMIN)', () => {
    it('mostra ambiente, segredos configurados (sem revelar) e URLs de webhook', async () => {
      signIn('ADMIN');
      mockSettingsApi();
      server.use(http.get(apiUrl('/settings/integrations'), () => HttpResponse.json(integrations())));
      renderRoutes(routes, '/configuracoes?aba=integracoes');

      expect(await screen.findByText('Sandbox (testes)')).toBeInTheDocument();
      const asaas = screen.getByText('Asaas').closest('[data-slot="card"]') as HTMLElement;
      expect(within(asaas).getByText('Configurada')).toBeInTheDocument();
      expect(within(asaas).getByText('Não configurado')).toBeInTheDocument();
      expect(within(asaas).getByText(`${window.location.origin}/api/v1/webhooks/asaas`)).toBeInTheDocument();
      expect(within(asaas).getByText('Nunca testado')).toBeInTheDocument();
      expect(screen.getByText('Simulado (FakeProvider, só para testes)')).toBeInTheDocument();
      expect(screen.getByText('localhost:1025')).toBeInTheDocument();
    });

    it('[FND-04.3] "Testar conexão" mostra a latência e passa a ser o último teste', async () => {
      signIn('ADMIN');
      mockSettingsApi();
      let tested = false;
      server.use(
        http.get(apiUrl('/settings/integrations'), () =>
          HttpResponse.json(
            integrations({
              lastTest: tested
                ? { ok: true, latencyMs: 120, error: null, testedAt: '2026-10-07T17:30:00.000Z', testedBy: 'Ana Souza' }
                : null,
            }),
          ),
        ),
        http.post(apiUrl('/settings/integrations/asaas/test'), () => {
          tested = true;
          return HttpResponse.json({ ok: true, latencyMs: 120, error: null, testedAt: '2026-10-07T17:30:00.000Z' });
        }),
      );
      renderRoutes(routes, '/configuracoes?aba=integracoes');

      await userEvent.click(await screen.findByRole('button', { name: 'Testar conexão' }));

      expect(await screen.findByText(/Conectado em/)).toHaveTextContent('Conectado em 120 ms');
      expect(screen.getByText(/por Ana Souza/)).toBeInTheDocument();
    });

    it('[FND-04.3] falha do Asaas aparece com o motivo', async () => {
      signIn('ADMIN');
      mockSettingsApi();
      server.use(
        http.get(apiUrl('/settings/integrations'), () =>
          HttpResponse.json(
            integrations({
              lastTest: {
                ok: false,
                latencyMs: 300,
                error: { code: 'ASAAS_AUTH', message: 'Chave de API recusada pelo Asaas.' },
                testedAt: '2026-10-07T17:30:00.000Z',
                testedBy: null,
              },
            }),
          ),
        ),
      );
      renderRoutes(routes, '/configuracoes?aba=integracoes');
      expect(await screen.findByText('Chave de API recusada pelo Asaas.')).toBeInTheDocument();
    });

    it('não-ADMIN que abre ?aba=integracoes cai na aba Geral', async () => {
      signIn('FINANCEIRO');
      mockSettingsApi();
      renderRoutes(routes, '/configuracoes?aba=integracoes');
      expect(await screen.findByLabelText('Nome da empresa')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Geral' })).toHaveAttribute('aria-selected', 'true');
    });
  });
});
