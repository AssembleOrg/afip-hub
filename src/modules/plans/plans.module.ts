import { Global, Module } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';

@Global()
@Module({
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
