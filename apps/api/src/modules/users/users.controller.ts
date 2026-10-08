import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  ResetPasswordSchema,
  UserCreateSchema,
  UserUpdateSchema,
  type ResetPasswordInput,
  type UserCreateInput,
  type UserUpdateInput,
} from '@financeiro/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PaginationSchema, type PaginationQuery } from '../../common/pagination';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Roles(...Permission.ADMINISTER)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar usuários' })
  list(@Query(new ZodValidationPipe(PaginationSchema)) query: PaginationQuery) {
    return this.users.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhar usuário' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Criar usuário' })
  create(
    @Body(new ZodValidationPipe(UserCreateSchema)) body: UserCreateInput,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.users.create(body, actorId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar, trocar papel, ativar ou desativar usuário' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UserUpdateSchema)) body: UserUpdateInput,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.users.update(id, body, actorId);
  }

  @Post(':id/reset-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Redefinir a senha (encerra as sessões do usuário)' })
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ResetPasswordSchema)) body: ResetPasswordInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<void> {
    await this.users.resetPassword(id, body.newPassword, actorId);
  }
}
