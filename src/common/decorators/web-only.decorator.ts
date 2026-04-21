import { SetMetadata } from '@nestjs/common';

export const WEB_ONLY_KEY = 'webOnly';
export const WebOnly = () => SetMetadata(WEB_ONLY_KEY, true);
