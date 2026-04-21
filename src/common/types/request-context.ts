import type { Request } from 'express';
import type { PlatformRole, OrgRole } from '../../../generated/prisma';

export interface AuthenticatedUser {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  platformRole: PlatformRole | null;
  organizationId: string | null;
  orgRole: OrgRole | null;
}

export interface ResolvedOrganization {
  id: string;
  slug: string;
  name: string;
  planId: string;
  planSlug: string;
  requestsLimit: number;
  pdfLimit: number;
  graceFactor: number;
  pdfRateLimitPerMin: number;
  taRateLimitPerMin: number;
  cuitLimit: number;
  subscriptionStatus: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  suspendedAt: Date | null;
}

export interface ResolvedApiKey {
  id: string;
  prefix: string;
  organizationId: string;
}

export interface SaasRequest extends Request {
  user?: AuthenticatedUser;
  organization?: ResolvedOrganization;
  apiKey?: ResolvedApiKey;
  _quotaWarning?: 'grace';
}
