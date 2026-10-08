import { z } from 'zod';
import { Role } from '../enums.js';

export const RoleEnum = z.enum([Role.ADMIN, Role.FINANCEIRO, Role.LEITURA]);

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}
