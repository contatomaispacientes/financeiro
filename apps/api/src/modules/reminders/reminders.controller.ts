import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ChargeSendSchema,
  Permission,
  ReminderListQuerySchema,
  ReminderPreviewSchema,
  ReminderTemplateUpsertSchema,
  type ReminderListQuery,
  type ReminderPreviewInput,
  type ReminderTemplateUpsertInput,
} from '@financeiro/shared';
import type { Env } from '../../config/env.schema';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { DomainException } from '../../common/filters/domain-exception.filter';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RemindersService } from './reminders.service';

const RunSchema = z.object({ date: z.iso.date().optional() });

@ApiTags('reminders')
@ApiBearerAuth()
@Controller()
export class RemindersController {
  constructor(
    private readonly reminders: RemindersService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get('reminder-templates')
  @Roles(...Permission.ADMINISTER)
  @ApiOperation({ summary: 'Mensagens da régua (REG-08.1)' })
  listTemplates() {
    return this.reminders.listTemplates();
  }

  @Put('reminder-templates')
  @Roles(...Permission.ADMINISTER)
  upsertTemplate(@Body(new ZodValidationPipe(ReminderTemplateUpsertSchema)) body: ReminderTemplateUpsertInput, @CurrentUser() actor: JwtPayload) {
    return this.reminders.upsertTemplate(body, actor);
  }

  @Delete('reminder-templates/:id')
  @HttpCode(204)
  @Roles(...Permission.ADMINISTER)
  async deleteTemplate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    await this.reminders.deleteTemplate(id, actor);
  }

  @Post('reminder-templates/:id/reset')
  @HttpCode(200)
  @Roles(...Permission.ADMINISTER)
  @ApiOperation({ summary: 'Restaurar o texto padrão (REG-08.4)' })
  resetTemplate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    return this.reminders.resetTemplate(id, actor);
  }

  @Post('reminder-templates/preview')
  @HttpCode(200)
  @Roles(...Permission.ADMINISTER)
  @ApiOperation({ summary: 'Prévia com uma cobrança real (REG-01.3)' })
  preview(@Body(new ZodValidationPipe(ReminderPreviewSchema)) body: ReminderPreviewInput) {
    return this.reminders.preview(body);
  }

  @Get('reminders')
  @Roles(...Permission.MANAGE_CHARGES)
  @ApiOperation({ summary: 'Envios da régua (REG-06)' })
  list(@Query(new ZodValidationPipe(ReminderListQuerySchema)) q: ReminderListQuery) {
    return this.reminders.list(q);
  }

  /** Testes manuais: roda o plano do dia agora. Fora de produção ou com o Asaas simulado. */
  @Post('reminders/run')
  @HttpCode(200)
  @Roles(...Permission.ADMINISTER)
  run(@Body(new ZodValidationPipe(RunSchema)) body: z.infer<typeof RunSchema>) {
    const allowed = this.config.get('NODE_ENV', { infer: true }) !== 'production' || this.config.get('ASAAS_ENV', { infer: true }) === 'mock';
    if (!allowed) throw new DomainException('NOT_FOUND', 'Disponível só em teste', HttpStatus.NOT_FOUND);
    return this.reminders.runDaily(body.date);
  }

  @Post('charges/:id/send')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_CHARGES)
  @ApiOperation({ summary: 'Enviar a cobrança ao cliente por e-mail (COB-10, REG-04.1)' })
  send(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ChargeSendSchema)) _body: { channel: 'EMAIL' }, @CurrentUser() actor: JwtPayload) {
    return this.reminders.sendManual(id, actor);
  }
}
