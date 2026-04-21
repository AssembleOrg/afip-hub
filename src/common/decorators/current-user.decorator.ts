import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SaasRequest, AuthenticatedUser } from '../types/request-context';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const req = ctx.switchToHttp().getRequest<SaasRequest>();
    return req.user;
  },
);
