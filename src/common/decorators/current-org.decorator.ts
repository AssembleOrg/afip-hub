import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SaasRequest, ResolvedOrganization } from '../types/request-context';

export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ResolvedOrganization | undefined => {
    const req = ctx.switchToHttp().getRequest<SaasRequest>();
    return req.organization;
  },
);
