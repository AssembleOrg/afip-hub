import { Global, Module } from '@nestjs/common';
import { AfipService } from './afip.service';
import { AfipController } from './afip.controller';
import { InvoicePdfService } from './invoice-pdf.service';

@Global()
@Module({
  controllers: [AfipController],
  providers: [AfipService, InvoicePdfService],
  exports: [AfipService, InvoicePdfService],
})
export class AfipModule {}
