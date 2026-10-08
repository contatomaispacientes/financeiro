import { PipeTransform, BadRequestException, ArgumentMetadata } from '@nestjs/common';
import type { ZodError, ZodType } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodType) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos',
          details: this.formatErrors(result.error),
        },
      });
    }

    return result.data;
  }

  private formatErrors(error: ZodError) {
    return error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
  }
}
