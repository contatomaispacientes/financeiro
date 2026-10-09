import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@financeiro/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ReconcileService } from './reconcile.service';

@ApiTags('webhooks')
@ApiBearerAuth()
@Controller()
export class ReconcileController {
  constructor(private readonly reconcile: ReconcileService) {}

  @Post('reconcile')
  @HttpCode(200)
  @Roles(...Permission.ADMINISTER)
  @ApiOperation({ summary: 'Reconciliar agora (WHK-04.4)' })
  run(@CurrentUser() actor: JwtPayload) {
    return this.reconcile.run('MANUAL', actor.sub);
  }

  @Post('charges/:id/sync')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_CHARGES)
  @ApiOperation({ summary: 'Atualizar a cobrança com o Asaas (COB-07.2)' })
  async sync(@Param('id', ParseUUIDPipe) id: string) {
    return { changed: await this.reconcile.sync(id) };
  }
}
