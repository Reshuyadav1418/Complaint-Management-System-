import { z } from 'zod';
import { password } from './common.js';

export const loginBody = z.object({
  email: z.email('Enter a valid email address.').max(254),
  password: z.string().min(1, 'Enter your password.').max(128),
});

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(128),
  newPassword: password,
});
