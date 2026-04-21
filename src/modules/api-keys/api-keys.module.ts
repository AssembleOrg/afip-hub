import { Global, Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';

@Global()
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
