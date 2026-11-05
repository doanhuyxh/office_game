import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Gộp className (dùng cho shadcn/ui). */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
