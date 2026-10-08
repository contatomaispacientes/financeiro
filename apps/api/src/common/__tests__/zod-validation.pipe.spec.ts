import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    name: z.string().min(2),
    age: z.number().int().positive(),
  });
  const pipe = new ZodValidationPipe(schema);
  const metadata = { type: 'body' as const, metatype: Object, data: '' };

  it('passes valid data through', () => {
    const input = { name: 'João', age: 30 };
    expect(pipe.transform(input, metadata)).toEqual(input);
  });

  it('strips unknown keys', () => {
    const input = { name: 'João', age: 30, extra: 'foo' };
    const result = pipe.transform(input, metadata);
    expect(result).toEqual({ name: 'João', age: 30 });
  });

  it('throws BadRequestException with VALIDATION_ERROR code on invalid data', () => {
    let caught: unknown;
    try {
      pipe.transform({ name: '', age: -1 }, metadata);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const response = (caught as BadRequestException).getResponse() as {
      error: { code: string; details: Array<{ path: string; message: string }> };
    };
    expect(response.error.code).toBe('VALIDATION_ERROR');
    expect(response.error.details.some((d) => d.path === 'name')).toBe(true);
    expect(response.error.details.some((d) => d.path === 'age')).toBe(true);
  });
});
