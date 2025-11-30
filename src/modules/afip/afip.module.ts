import { Module } from '@nestjs/common';
import { AfipService } from './afip.service';
import { AfipController } from './afip.controller';

@Module({
  controllers: [AfipController],
  providers: [AfipService],
  exports: [AfipService],
})
export class AfipModule {}

