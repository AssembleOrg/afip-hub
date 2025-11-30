import { SetMetadata } from '@nestjs/common';

export const AUDITORY_KEY = 'auditory';
export const Auditory = (action?: string) => SetMetadata(AUDITORY_KEY, action || true);

