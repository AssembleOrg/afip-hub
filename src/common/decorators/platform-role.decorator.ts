import { SetMetadata } from '@nestjs/common';
import { PlatformRole } from '../../../generated/prisma';

export const PLATFORM_ROLES_KEY = 'platformRoles';

export const RequirePlatformRole = (...roles: PlatformRole[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);
