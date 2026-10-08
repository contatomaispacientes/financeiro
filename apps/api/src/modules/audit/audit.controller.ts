import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLogQuerySchema, Permission, type AuditLogQuery } from '@financeiro/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Roles(...Permission.ADMINISTER)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Consultar auditoria (filtros: entidade, usuário, período)' })
  list(@Query(new ZodValidationPipe(AuditLogQuerySchema)) query: AuditLogQuery) {
    return this.audit.list(query);
  }
}
