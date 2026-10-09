import { can, reminderKindLabels } from '@financeiro/shared';
import { useSession } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useReminders } from './api';

const statusLabels = { SENT: 'enviado', SKIPPED: 'não enviado', FAILED: 'falhou' } as const;

/** REG-06.1: mensagens da régua desta cobrança. */
export function ChargeReminders({ chargeId }: { chargeId: string }) {
  const { user } = useSession();
  const allowed = can(user?.role, 'MANAGE_CHARGES');
  const reminders = useReminders({ chargeId }, allowed);
  if (!allowed) return null;

  return (
    <section aria-labelledby="charge-reminders">
      <h2 id="charge-reminders" className="mb-2 text-sm font-medium">Mensagens ao cliente</h2>
      {!reminders.data || reminders.data.data.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          Nenhuma mensagem ainda. A régua avisa antes e depois do vencimento.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card px-4 text-sm">
          {reminders.data.data.map((r) => (
            <li key={r.id} className="py-2">
              <p className="font-medium">{reminderKindLabels[r.kind]}</p>
              <p className="text-xs text-muted-foreground">
                <span className="tabular">{formatDateTime(r.sentAt)}</span> · e-mail · {statusLabels[r.status]}
                {r.error && ` · ${r.error}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
