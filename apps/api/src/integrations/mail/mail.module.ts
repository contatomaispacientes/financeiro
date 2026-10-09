import { Global, Module } from '@nestjs/common';
import { MailProvider } from './mail.provider';

@Global()
@Module({ providers: [MailProvider], exports: [MailProvider] })
export class MailModule {}
