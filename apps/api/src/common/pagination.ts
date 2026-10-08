import { z } from 'zod';
import type { Paginated } from '@financeiro/shared';

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationSchema>;

export type PaginatedResponse<T> = Paginated<T>;

export function paginatedResponse<T>(
  data: T[],
  total: number,
  query: PaginationQuery,
): PaginatedResponse<T> {
  return {
    data,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
    },
  };
}

export function paginationToSkipTake(query: PaginationQuery) {
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  };
}
