import { z } from 'zod';

// Mensagens de validação em pt-BR na API e no web (CLAUDE.md: interface em português).
z.config(z.locales.ptBR());

export { z };
