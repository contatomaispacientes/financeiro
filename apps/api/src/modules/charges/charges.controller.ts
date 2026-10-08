import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ChargeCancelSchema,
  ChargeCreateRequestSchema,
  ChargeListQuerySchema,
  ChargeRefundSchema,
  Permission,
  type ChargeCancelInput,
  type ChargeCreateRequest,
  type ChargeListQuery,
  type ChargeRefundInput,
  type Role,
} from '@financeiro/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ChargesService } from './charges.service';

@ApiTags('charges')
@ApiBearerAuth()
@Controller('charges')
export class ChargesController {
  constructor(private readonly charges: ChargesService) {}

  @Post('preview')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_CHARGES)
  @ApiOperation({ summary: 'Prévia do plano de cobrança, sem efeitos colaterais (COB-01.4)' })
  preview(@Body(new ZodValidationPipe(ChargeCreateRequestSchema)) body: ChargeCreateRequest) {
    return this.charges.preview(body);
  }

  @Post()
  @Roles(...Permission.MANAGE_CHARGES)
  @ApiOperation({ summary: 'Gerar cobrança no Asaas (COB-02)' })
  create(
    @Body(new ZodValidationPipe(ChargeCreateRequestSchema)) body: ChargeCreateRequest,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.charges.create(body, actor);
  }

  @Get()
  @Roles(...Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Lista de cobranças com filtros, contagem por status e soma (COB-06)' })
  list(@Query(new ZodValidationPipe(ChargeListQuerySchema)) query: ChargeListQuery) {
    return this.charges.list(query);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_CHARGES)
  @ApiOperation({ summary: 'Cancelar cobrança ou parcelas em aberto (COB-08)' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ChargeCancelSchema)) body: ChargeCancelInput,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.charges.cancel(id, body, actor);
  }

  @Post(':id/refund')
  @HttpCode(200)
  @Roles(...Permission.REFUND_CHARGE)
  @ApiOperation({ summary: 'Estornar cobrança paga, total ou parcial (COB-09)' })
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ChargeRefundSchema)) body: ChargeRefundInput,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.charges.refund(id, body, actor);
  }

  @Get(':id')
  @Roles(...Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Detalhe da cobrança com itens e eventos (COB-07.1)' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('role') role: Role) {
    return this.charges.get(id, role);
  }

  @Get(':id/payment-info')
  @Roles(...Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Link da fatura, Pix e linha digitável (COB-05)' })
  paymentInfo(@Param('id', ParseUUIDPipe) id: string) {
    return this.charges.paymentInfo(id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_CHARGES)
  @ApiOperation({ summary: 'Tentar de novo o envio ao Asaas, sem duplicar (COB-12)' })
  retry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    return this.charges.retry(id, actor);
  }

  @Post(':id/discard')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_CHARGES)
  @ApiOperation({ summary: 'Descartar rascunho (COB-12.1)' })
  discard(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    return this.charges.discard(id, actor);
  }
}
