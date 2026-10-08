import type { AuditLogDto } from '@financeiro/shared';
import { fieldLabels, formatAuditValue, loginFailureReasons } from './labels';

type Diff = { before: Record<string, unknown>; after: Record<string, unknown> };

function isDiff(data: unknown): data is Diff {
  return (
    typeof data === 'object' &&
    data !== null &&
    'before' in data &&
    'after' in data &&
    typeof (data as Diff).after === 'object'
  );
}

/** Contexto de um registro de auditoria em texto legível. */
export function AuditDetails({ log }: { log: AuditLogDto }) {
  const data = log.data as Record<string, unknown> | null;
  if (!data) return <span className="text-muted-foreground">—</span>;

  if (isDiff(data)) {
    return (
      <ul className="space-y-0.5">
        {Object.keys(data.after).map((field) => (
          <li key={field}>
            <span className="text-muted-foreground">{fieldLabels[field] ?? field}:</span>{' '}
            <span className="line-through decoration-muted-foreground/60">{formatAuditValue(field, data.before[field])}</span>
            {' → '}
            <span className="font-medium">{formatAuditValue(field, data.after[field])}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (log.action === 'auth.login_failed') {
    const reason = loginFailureReasons[String(data['reason'])] ?? String(data['reason']);
    return (
      <span>
        {String(data['email'])} <span className="text-muted-foreground">· {reason}</span>
      </span>
    );
  }

  if (log.action === 'integration.asaas_test') {
    const error = data['error'] as { message?: string } | null;
    return data['ok'] ? (
      <span>Conectado em {String(data['latencyMs'])} ms</span>
    ) : (
      <span className="text-destructive">{error?.message ?? 'Falhou'}</span>
    );
  }

  return (
    <ul className="space-y-0.5">
      {Object.entries(data).map(([field, value]) => (
        <li key={field}>
          <span className="text-muted-foreground">{fieldLabels[field] ?? field}:</span> {formatAuditValue(field, value)}
        </li>
      ))}
    </ul>
  );
}
