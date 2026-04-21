import { Global, Module } from '@nestjs/common';
import { CertificatesCryptoService } from './certificates-crypto.service';

@Global()
@Module({
  providers: [CertificatesCryptoService],
  exports: [CertificatesCryptoService],
})
export class CertificatesCryptoModule {}
