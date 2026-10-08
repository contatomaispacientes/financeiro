import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated, UserCreateInput, UserDto, UserUpdateInput } from '@financeiro/shared';
import { get, patch, post } from '@/lib/api';

export const USERS_PAGE_SIZE = 20;

export const usersKeys = {
  all: ['users'] as const,
  list: (page: number, pageSize: number) => ['users', 'list', page, pageSize] as const,
};

export function useUsers(page: number, pageSize = USERS_PAGE_SIZE) {
  return useQuery({
    queryKey: usersKeys.list(page, pageSize),
    queryFn: () => get<Paginated<UserDto>>('/users', { page, pageSize }),
    placeholderData: keepPreviousData,
  });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: usersKeys.all });
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (input: UserCreateInput) => post<UserDto>('/users', input),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UserUpdateInput }) =>
      patch<UserDto>(`/users/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      post<void>(`/users/${id}/reset-password`, { newPassword }),
  });
}
