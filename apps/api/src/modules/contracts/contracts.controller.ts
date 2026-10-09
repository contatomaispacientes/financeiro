import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ChargePlanSchema,
  ContractCancelSchema,
  ContractDraftSchema,
  ContractListQuerySchema,
  ContractUpdateSchema,
  Permission,
  TemplateUpdateSchema,
  TemplateUpsertSchema,
  type ContractDraft,
  type ContractListQuery,
  type ContractUpdateInput,
  type TemplateUpdateInput,
  type TemplateUpsertInput,
} from '@financeiro/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ContractTemplatesService } from './contract-templates.service';
import { ContractsService } from './contracts.service';

const TemplatePreviewSchema = z.object({ customerId: z.uuid().optional(), chargePlan: ChargePlanSchema.optional() });
const ActiveQuerySchema = z.object({ active: z.enum(['true', 'false']).optional() });

@ApiTags('contracts')
@ApiBearerAuth()
@Controller('contract-templates')
export class ContractTemplatesController {
  constructor(private readonly templates: ContractTemplatesService) {}

  @Get()
  @Roles(...Permission.VIEW_REPORTS)
  list(@Query(new ZodValidationPipe(ActiveQuerySchema)) q: z.infer<typeof ActiveQuerySchema>) {
    return this.templates.list(q.active === undefined ? undefined : q.active === 'true');
  }

  @Post()
  @Roles(...Permission.MANAGE_CONTRACT_TEMPLATES)
  @ApiOperation({ summary: 'Cadastrar modelo (CTR-01.1)' })
  create(@Body(new ZodValidationPipe(TemplateUpsertSchema)) body: TemplateUpsertInput, @CurrentUser() actor: JwtPayload) {
    return this.templates.create(body, actor);
  }

  @Patch(':id')
  @Roles(...Permission.MANAGE_CONTRACT_TEMPLATES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(TemplateUpdateSchema)) body: TemplateUpdateInput,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.templates.update(id, body, actor);
  }

  @Post(':id/preview')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_CONTRACT_TEMPLATES)
  @ApiOperation({ summary: 'Prévia do mapeamento com dados de exemplo (CTR-01.4)' })
  preview(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(TemplatePreviewSchema)) body: z.infer<typeof TemplatePreviewSchema>) {
    return this.templates.preview(id, body);
  }
}

@ApiTags('contracts')
@ApiBearerAuth()
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @Roles(...Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Contratos (CTR-07.1)' })
  list(@Query(new ZodValidationPipe(ContractListQuerySchema)) q: ContractListQuery) {
    return this.contracts.list(q);
  }

  @Post()
  @Roles(...Permission.MANAGE_CONTRACTS)
  @ApiOperation({ summary: 'Criar rascunho (CTR-02)' })
  create(@Body(new ZodValidationPipe(ContractDraftSchema)) body: ContractDraft, @CurrentUser() actor: JwtPayload) {
    return this.contracts.create(body, actor);
  }

  @Get(':id')
  @Roles(...Permission.VIEW_REPORTS)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.get(id);
  }

  @Patch(':id')
  @Roles(...Permission.MANAGE_CONTRACTS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ContractUpdateSchema)) body: ContractUpdateInput,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.contracts.update(id, body, actor);
  }

  @Post(':id/preview')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_CONTRACTS)
  @ApiOperation({ summary: 'Variáveis resolvidas e o que falta (CTR-02.5, CTR-02.6)' })
  preview(@Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.preview(id);
  }

  @Post(':id/send')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_CONTRACTS)
  @ApiOperation({ summary: 'Enviar para assinatura (CTR-03)' })
  send(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    return this.contracts.send(id, actor);
  }

  @Post(':id/discard')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_CONTRACTS)
  discard(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    return this.contracts.discard(id, actor);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_CONTRACTS)
  @ApiOperation({ summary: 'Cancelar contrato enviado (CTR-06.2)' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ContractCancelSchema)) body: { reason?: string },
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.contracts.cancel(id, body.reason, actor);
  }

  @Post(':id/signers/:signerId/resend')
  @HttpCode(204)
  @Roles(...Permission.MANAGE_CONTRACTS)
  @ApiOperation({ summary: 'Reenviar convite (CTR-06.1)' })
  async resend(@Param('id', ParseUUIDPipe) id: string, @Param('signerId', ParseUUIDPipe) signerId: string, @CurrentUser() actor: JwtPayload) {
    await this.contracts.resend(id, signerId, actor);
  }

  @Post(':id/generate-charge')
  @HttpCode(202)
  @Roles(...Permission.MANAGE_CONTRACTS)
  @ApiOperation({ summary: 'Tentar gerar a cobrança de novo (CTR-05.4)' })
  generateCharge(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    return this.contracts.generateCharge(id, actor);
  }

  @Get(':id/signed-file')
  @Roles(...Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Link assinado do PDF assinado (CTR-NF2)' })
  signedFile(@Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.signedFileUrl(id);
  }
}
