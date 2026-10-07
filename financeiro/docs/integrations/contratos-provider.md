# Provedor de contratos (assinatura eletrônica)

> Status: provedor escolhido — **Clicksign API v3** (ADR-009). Detalhes do mapeamento em `contratos-clicksign.md`. Implementar contra a interface abaixo, começando pelo `FakeProvider` (ADR-005), que continua sendo usado em dev e testes.

## Interface `ContractProvider`

```ts
type ProviderName = 'fake' | 'clicksign';
type AuthMethod = 'email' | 'whatsapp' | 'sms';

// Ids já criados no provedor em tentativas anteriores (o Clicksign cria em várias chamadas)
interface ProviderProgress {
  envelopeId?: string;
  documentId?: string;
  signerIds?: Record<string, string>;      // contract_signers.id → id no provedor
  requirementsDone?: boolean;
  activated?: boolean;
}

interface CreateDocumentInput {
  externalId: string;                  // contracts.id
  title: string;
  templateId: string;                  // contract_templates.provider_template_id
  fields: Record<string, string>;      // já resolvido pelo variable_map
  signers: Array<{
    externalId: string;                // contract_signers.id
    name: string; email: string; phone?: string; document?: string;
    role: 'CLIENT' | 'COMPANY' | 'WITNESS';
    order: number;
    authMethod: AuthMethod;
  }>;
  expiresAt?: Date;
  locale: 'pt-BR';
  resume?: ProviderProgress;                              // retomar sem duplicar
  onProgress?: (p: ProviderProgress) => Promise<void>;    // chamado após cada passo; o service grava no banco
}

interface ProviderDocument {
  providerEnvelopeId?: string;
  providerDocumentId: string;
  status: 'PENDING' | 'SIGNED' | 'REFUSED' | 'EXPIRED' | 'CANCELED';
  signers: Array<{ externalId: string; providerSignerId: string; signUrl?: string; status: 'PENDING' | 'SIGNED' | 'REFUSED'; signedAt?: Date }>;
}

type NormalizedContractEvent =
  | { type: 'SIGNER_SIGNED'; eventId: string; providerDocumentId: string; providerSignerId?: string; signerEmail?: string; at: Date }
  | { type: 'SIGNER_REFUSED'; eventId: string; providerDocumentId: string; providerSignerId?: string; signerEmail?: string; at: Date; reason?: string }
  | { type: 'DOCUMENT_COMPLETED'; eventId: string; providerDocumentId: string; at: Date; signedFileUrl?: string }
  | { type: 'DOCUMENT_EXPIRED'; eventId: string; providerDocumentId: string; at: Date }
  | { type: 'DOCUMENT_CANCELED'; eventId: string; providerDocumentId: string; at: Date }
  | { type: 'IGNORED'; eventId: string; raw: string };

interface ContractProvider {
  readonly name: ProviderName;
  createDocument(input: CreateDocumentInput): Promise<ProviderDocument>;
  getDocument(providerDocumentId: string): Promise<ProviderDocument>;
  cancelDocument(providerDocumentId: string): Promise<void>;
  resendToSigner(providerDocumentId: string, providerSignerId: string): Promise<void>;
  downloadSignedFile(providerDocumentId: string): Promise<{ contentType: string; data: Buffer }>;
  listTemplates?(): Promise<Array<{ id: string; name: string; fields: string[] }>>;
  verifyWebhook(headers: Record<string, string>, rawBody: Buffer): boolean;   // Clicksign: Content-Hmac
  parseWebhook(body: unknown): NormalizedContractEvent[];
}
```

O signatário do evento é localizado por `providerSignerId` e, se ausente, por e-mail dentro do contrato.

Quando o eventId não vier do provedor, gerar um determinístico: `sha256(providerDocumentId + type + signerId + timestamp)`.

## Catálogo de variáveis

Usadas no `variable_map` dos modelos. Resolvidas por `ContractVariablesService` a partir do cliente, do plano e das configurações.

| Variável | Exemplo |
| --- | --- |
| `cliente.nome` | Padaria Bom Grão Ltda |
| `cliente.documento` | 12.345.678/0001-90 |
| `cliente.tipo` | pessoa jurídica |
| `cliente.email` / `cliente.telefone` | |
| `cliente.endereco` | Rua X, 100 — Bairro — Cidade/UF — CEP |
| `empresa.nome` / `empresa.documento` | das Configurações |
| `servicos.lista` | "Gestão de redes sociais (1x) — R$ 1.200,00; …" |
| `servicos.total` | R$ 2.700,00 |
| `cobranca.desconto` | R$ 0,00 |
| `cobranca.valor_total` | R$ 2.700,00 |
| `cobranca.forma` | Pix, boleto ou cartão |
| `cobranca.condicao` | "3 parcelas de R$ 900,00" / "mensal de R$ 2.700,00" / "pagamento único" |
| `cobranca.vencimento` | "10/10/2026" ou "3 dias após a assinatura" |
| `cobranca.multa` / `cobranca.juros` | 2% / 1% ao mês |
| `contrato.data` | 07 de outubro de 2026 |
| `contrato.cidade` | das Configurações |

## FakeProvider (dev e testes)

- Guarda documentos em memória (ou tabela `fake_provider_documents` só em dev).
- `signUrl` aponta para uma página da própria API: `GET /dev/fake-sign/:docId/:signerId` com botões **Assinar** e **Recusar**, que disparam o webhook `POST /webhooks/contracts/fake` assinado com `FAKE_CONTRACT_WEBHOOK_SECRET` (mesmo esquema `Content-Hmac` do Clicksign, para exercitar o mesmo código de verificação).
- `downloadSignedFile` devolve um PDF fixo de exemplo.
- Rotas `/dev/*` só existem com `NODE_ENV !== 'production'`.

## Provedor real

Clicksign API v3 — ver `contratos-clicksign.md` e ADR-009. Para trocar de provedor no futuro: novo adapter que passe na suíte `contractProviderConformance`, novo documento de integração e novo ADR.
