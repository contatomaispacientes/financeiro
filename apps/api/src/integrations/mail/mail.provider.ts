import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../config/env.schema';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * E-mail da plataforma (stack.md: Nodemailer/SMTP atrás de `MailProvider`). Mailpit em dev (REG-NF2).
 * `SMTP_HOST` vazio = e-mail desligado; `SMTP_HOST=json` = não envia, só registra (testes e demonstração).
 */
@Injectable()
export class MailProvider {
  private readonly logger = new Logger(MailProvider.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    const host = config.get('SMTP_HOST', { infer: true });
    const port = config.get('SMTP_PORT', { infer: true });
    const user = config.get('SMTP_USER', { infer: true });
    this.from = config.get('MAIL_FROM', { infer: true });
    if (!host) this.transport = null;
    else if (host === 'json') this.transport = createTransport({ jsonTransport: true });
    else {
      this.transport = createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass: config.get('SMTP_PASS', { infer: true }) ?? '' } : undefined,
        connectionTimeout: 15_000,
      });
    }
  }

  get configured(): boolean {
    return this.transport !== null;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transport) throw new Error('E-mail não configurado no servidor (SMTP_HOST)');
    await this.transport.sendMail({ from: this.from, ...message });
    // Nunca logar o destinatário nem o conteúdo (dados do cliente).
    this.logger.debug('E-mail enviado');
  }
}
