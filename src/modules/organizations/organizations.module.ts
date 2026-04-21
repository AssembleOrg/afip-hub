import { Global, Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';

@Global()
@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
