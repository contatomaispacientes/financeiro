import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, SubscriptionListQuerySchema, type SubscriptionListQuery } from '@financeiro/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @Roles(...Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Recorrências (COB-04.4)' })
  list(@Query(new ZodValidationPipe(SubscriptionListQuerySchema)) query: SubscriptionListQuery) {
    return this.subscriptions.list(query);
  }

  @Get(':id')
  @Roles(...Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Detalhe da recorrência com as cobranças geradas (COB-04.4)' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.get(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(...Permission.CANCEL_SUBSCRIPTION)
  @ApiOperation({ summary: 'Cancelar recorrência (COB-11)' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    return this.subscriptions.cancel(id, actor.sub);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_CHARGES)
  @ApiOperation({ summary: 'Tentar de novo criar a recorrência no Asaas, sem duplicar' })
  retry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    return this.subscriptions.retry(id, actor.sub);
  }
}
