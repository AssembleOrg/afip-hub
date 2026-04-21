import { Global, Module } from '@nestjs/common';
import { EmisoresService } from './emisores.service';
import { EmisoresController } from './emisores.controller';

@Global()
@Module({
  controllers: [EmisoresController],
  providers: [EmisoresService],
  exports: [EmisoresService],
})
export class EmisoresModule {}
