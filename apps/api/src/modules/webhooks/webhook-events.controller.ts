import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, WebhookEventQuerySchema, type WebhookEventQuery } from '@financeiro/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { WebhookEventsService } from './webhook-events.service';

@ApiTags('webhooks')
@ApiBearerAuth()
@Roles(...Permission.ADMINISTER)
@Controller('webhook-events')
export class WebhookEventsController {
  constructor(private readonly events: WebhookEventsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(WebhookEventQuerySchema)) query: WebhookEventQuery) {
    return this.events.list(query);
  }

  // Antes de ':id' para "health" não ser lido como id.
  @Get('health')
  health() {
    return this.events.health();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.get(id);
  }

  @Post(':id/reprocess')
  @HttpCode(200)
  reprocess(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    return this.events.reprocess(id, actor);
  }
}
