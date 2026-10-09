import { describe, expect, it } from 'vitest';
import { checkTemplateVariables, DEFAULT_REMINDER_TEMPLATES, REMINDER_KINDS, renderReminderText } from '../schemas/reminders.js';

describe('régua — mensagens', () => {
  it('[REG-01.4] recusa variável desconhecida e variável fora do tipo', () => {
    expect(checkTemplateVariables('CREATED', 'Olá {cliente}')).toEqual({ ok: true });
    expect(checkTemplateVariables('CREATED', 'Olá {apelido}')).toMatchObject({ code: 'REMINDER_UNKNOWN_VARIABLE', variable: 'apelido' });
    expect(checkTemplateVariables('CREATED', 'Atraso: {dias_atraso}')).toMatchObject({ code: 'REMINDER_VARIABLE_NOT_AVAILABLE' });
    expect(checkTemplateVariables('AFTER_DUE', 'Atraso: {dias_atraso}')).toEqual({ ok: true });
  });

  it('[REG-01.2] renderiza e some com variável vazia sem deixar espaço duplo', () => {
    expect(renderReminderText('Serviço {parcela} de {valor}.', { parcela: '', valor: 'R$ 10,00' })).toBe('Serviço de R$ 10,00.');
    expect(renderReminderText('Parcela {parcela} .', { parcela: '2/3' })).toBe('Parcela 2/3.');
  });

  it('[REG-08.5] textos padrão para todos os tipos, válidos e com PAID/REFUNDED/CANCELED desativados', () => {
    for (const kind of REMINDER_KINDS) {
      const t = DEFAULT_REMINDER_TEMPLATES[kind];
      expect(checkTemplateVariables(kind, t.subject, t.body)).toEqual({ ok: true });
      expect(t.active).toBe(!['PAID', 'REFUNDED', 'CANCELED'].includes(kind));
    }
  });
});
