import { Global, Module } from '@nestjs/common';
import { CertificatesService } from './certificates.service';
import { CertificatesController } from './certificates.controller';
import { CertificateExpirationCron } from './certificate-expiration.cron';

@Global()
@Module({
  controllers: [CertificatesController],
  providers: [CertificatesService, CertificateExpirationCron],
  exports: [CertificatesService],
})
export class CertificatesModule {}
