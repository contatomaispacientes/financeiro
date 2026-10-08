import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CategorySchema,
  CategoryUpdateSchema,
  ExpenseCreateSchema,
  ExpenseListQuerySchema,
  ExpensePaySchema,
  ExpenseUpdateSchema,
  Permission,
  RecurrenceCreateSchema,
  RecurrenceUpdateSchema,
  type CategoryInput,
  type ExpenseCreateInput,
  type ExpenseListQuery,
  type ExpensePayInput,
  type ExpenseUpdateInput,
  type RecurrenceCreateInput,
  type RecurrenceUpdateInput,
} from '@financeiro/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ExpensesService } from './expenses.service';

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @Roles(...Permission.VIEW_REPORTS)
  list(@Query(new ZodValidationPipe(ExpenseListQuerySchema)) query: ExpenseListQuery) {
    return this.expenses.list(query);
  }

  @Post()
  @Roles(...Permission.MANAGE_RECORDS)
  create(@Body(new ZodValidationPipe(ExpenseCreateSchema)) body: ExpenseCreateInput, @CurrentUser() actor: JwtPayload) {
    return this.expenses.create(body, actor);
  }

  @Patch(':id')
  @Roles(...Permission.MANAGE_RECORDS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ExpenseUpdateSchema)) body: ExpenseUpdateInput,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.expenses.update(id, body, actor);
  }

  @Post(':id/pay')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_RECORDS)
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ExpensePaySchema)) body: ExpensePayInput,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.expenses.pay(id, body, actor);
  }

  @Post(':id/unpay')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_RECORDS)
  unpay(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    return this.expenses.unpay(id, actor);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_RECORDS)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    return this.expenses.cancel(id, actor);
  }

  /** DSP-01.1: multipart `file`, PDF ou imagem até 5 MB (substitui o anterior). */
  @Post(':id/attachment')
  @HttpCode(200)
  @Roles(...Permission.MANAGE_RECORDS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.expenses.attach(id, file?.buffer ?? Buffer.alloc(0), actor);
  }

  /** DSP-NF1: `{ url }` assinado, válido por 5 minutos. */
  @Get(':id/attachment')
  @Roles(...Permission.VIEW_REPORTS)
  attachmentUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.attachmentUrl(id);
  }

  @Delete(':id/attachment')
  @Roles(...Permission.MANAGE_RECORDS)
  detach(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload) {
    return this.expenses.detach(id, actor);
  }
}

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expense-recurrences')
export class ExpenseRecurrencesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @Roles(...Permission.VIEW_REPORTS)
  list() {
    return this.expenses.listRecurrences();
  }

  @Post()
  @Roles(...Permission.MANAGE_RECORDS)
  create(@Body(new ZodValidationPipe(RecurrenceCreateSchema)) body: RecurrenceCreateInput, @CurrentUser() actor: JwtPayload) {
    return this.expenses.createRecurrence(body, actor);
  }

  @Patch(':id')
  @Roles(...Permission.MANAGE_RECORDS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RecurrenceUpdateSchema)) body: RecurrenceUpdateInput,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.expenses.updateRecurrence(id, body, actor);
  }
}

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @Roles(...Permission.VIEW_REPORTS)
  list() {
    return this.expenses.listCategories();
  }

  @Post()
  @Roles(...Permission.ADMINISTER)
  create(@Body(new ZodValidationPipe(CategorySchema)) body: CategoryInput, @CurrentUser() actor: JwtPayload) {
    return this.expenses.createCategory(body, actor);
  }

  @Patch(':id')
  @Roles(...Permission.ADMINISTER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CategoryUpdateSchema)) body: Partial<CategoryInput>,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.expenses.updateCategory(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(...Permission.ADMINISTER)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: JwtPayload): Promise<void> {
    await this.expenses.deleteCategory(id, actor);
  }
}
