import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { AuthenticatedUser } from '@/common/types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') || 'your-secret-key',
    });
  }

  async validate(payload: { sub: string }): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        platformRole: true,
        organizationId: true,
        orgRole: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Usuario no encontrado o eliminado');
    }

    return {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      platformRole: user.platformRole,
      organizationId: user.organizationId,
      orgRole: user.orgRole,
    };
  }
}
