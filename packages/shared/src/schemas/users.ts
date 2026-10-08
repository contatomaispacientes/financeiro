import { z } from '../zod.js';
import { RoleEnum } from './auth.js';
import type { Role } from '../enums.js';

const email = z.string().trim().toLowerCase().pipe(z.email());
const password = z.string().min(10, 'A senha precisa ter ao menos 10 caracteres').max(128);

export const UserCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email,
  role: RoleEnum,
  password,
});
export type UserCreateInput = z.infer<typeof UserCreateSchema>;

export const UserUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email,
    role: RoleEnum,
    active: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'Informe ao menos um campo' });
export type UserUpdateInput = z.infer<typeof UserUpdateSchema>;

export const ResetPasswordSchema = z.object({ newPassword: password });
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
