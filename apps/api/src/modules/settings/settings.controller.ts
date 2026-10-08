import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  SettingsUpdateSchema,
  type EnvironmentDto,
  type SettingsUpdateInput,
} from '@financeiro/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Roles(...Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Padrões financeiros e da régua' })
  get() {
    return this.settings.get();
  }

  @Patch()
  @Roles(...Permission.ADMINISTER)
  @ApiOperation({ summary: 'Alterar configurações (auditado com antes/depois)' })
  update(
    @Body(new ZodValidationPipe(SettingsUpdateSchema)) body: SettingsUpdateInput,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.settings.update(body, actorId);
  }

  @Get('environment')
  @Roles(...Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Ambiente do Asaas (selo no menu, todos os papéis)' })
  environment(): EnvironmentDto {
    return this.settings.environment();
  }

  @Get('integrations')
  @Roles(...Permission.ADMINISTER)
  @ApiOperation({ summary: 'Estado das integrações (nunca expõe segredos)' })
  integrations() {
    return this.settings.integrations();
  }

  @Post('integrations/asaas/test')
  @HttpCode(200)
  @Roles(...Permission.ADMINISTER)
  @ApiOperation({ summary: 'Testar conexão com o Asaas' })
  testAsaas(@CurrentUser('sub') actorId: string) {
    return this.settings.testAsaas(actorId);
  }
}
