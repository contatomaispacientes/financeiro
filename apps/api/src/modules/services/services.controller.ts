import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  ServiceCreateSchema,
  ServiceListQuerySchema,
  ServiceUpdateSchema,
  type ServiceCreateInput,
  type ServiceListQuery,
  type ServiceUpdateInput,
} from '@financeiro/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ServicesService } from './services.service';

@ApiTags('services')
@ApiBearerAuth()
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @Roles(...Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Listar serviços com quantidade de vendas (SRV-03.1)' })
  list(@Query(new ZodValidationPipe(ServiceListQuerySchema)) query: ServiceListQuery) {
    return this.services.list(query);
  }

  @Post()
  @Roles(...Permission.MANAGE_RECORDS)
  @ApiOperation({ summary: 'Cadastrar serviço (SRV-01)' })
  create(
    @Body(new ZodValidationPipe(ServiceCreateSchema)) body: ServiceCreateInput,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.services.create(body, actor);
  }

  @Patch(':id')
  @Roles(...Permission.MANAGE_RECORDS)
  @ApiOperation({ summary: 'Editar, ativar ou desativar serviço (SRV-01, SRV-02.1)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ServiceUpdateSchema)) body: ServiceUpdateInput,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.services.update(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(...Permission.MANAGE_RECORDS)
  @ApiOperation({ summary: 'Excluir serviço nunca usado (SRV-02.2)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload): Promise<void> {
    await this.services.remove(id, actor);
  }
}
