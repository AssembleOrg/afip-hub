import { Global, Module } from '@nestjs/common';
import { PlatformCertService } from './platform-cert.service';
import { PlatformCertController } from './platform-cert.controller';

@Global()
@Module({
  controllers: [PlatformCertController],
  providers: [PlatformCertService],
  exports: [PlatformCertService],
})
export class PlatformCertModule {}
