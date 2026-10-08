import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CustomerCreateSchema,
  CustomerLookupQuerySchema,
  CustomerUpdateSchema,
  Permission,
  type CustomerCreateInput,
  type CustomerUpdateInput,
  type Role,
} from '@financeiro/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  // Antes de ':id' para "lookup" não ser lido como id.
  @Get('lookup')
  @Roles(...Permission.MANAGE_RECORDS)
  @ApiOperation({ summary: 'Verifica se já existe cliente com o documento (CLI-01.3)' })
  lookup(@Query(new ZodValidationPipe(CustomerLookupQuerySchema)) query: { document: string }) {
    return this.customers.lookup(query.document);
  }

  @Post()
  @Roles(...Permission.MANAGE_RECORDS)
  @ApiOperation({ summary: 'Cadastrar cliente' })
  create(
    @Body(new ZodValidationPipe(CustomerCreateSchema)) body: CustomerCreateInput,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.customers.create(body, actor);
  }

  @Get(':id')
  @Roles(...Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Ficha do cliente com totais, cobranças, assinaturas e contratos' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('role') role: Role) {
    return this.customers.get(id, role);
  }

  @Patch(':id')
  @Roles(...Permission.MANAGE_RECORDS)
  @ApiOperation({ summary: 'Editar cliente' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CustomerUpdateSchema)) body: CustomerUpdateInput,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.customers.update(id, body, actor);
  }
}
