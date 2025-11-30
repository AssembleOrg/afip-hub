import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import envConfig from './env.config';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [envConfig],
      envFilePath: '.env',
    }),
  ],
})
export class ConfigModule {}

