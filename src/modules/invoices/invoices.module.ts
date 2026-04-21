import { Global, Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';

@Global()
@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
