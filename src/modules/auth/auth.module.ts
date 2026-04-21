import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshTokensService } from './refresh-tokens.service';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): any => {
        const expiresIn = configService.get<string>('jwt.expiresIn') || '24h';
        return {
          secret: configService.get<string>('jwt.secret') || 'your-secret-key',
          signOptions: {
            expiresIn: expiresIn,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, DevicesController],
  providers: [AuthService, JwtStrategy, RefreshTokensService, DevicesService],
  exports: [AuthService, RefreshTokensService, DevicesService],
})
export class AuthModule {}

