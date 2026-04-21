import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailTemplateRenderer } from './template-renderer';

@Global()
@Module({
  providers: [EmailService, EmailTemplateRenderer],
  exports: [EmailService, EmailTemplateRenderer],
})
export class EmailModule {}
