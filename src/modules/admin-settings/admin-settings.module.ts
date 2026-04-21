import { Global, Module } from '@nestjs/common';
import { AdminSettingsService } from './admin-settings.service';
import { AdminSettingsController } from './admin-settings.controller';

@Global()
@Module({
  controllers: [AdminSettingsController],
  providers: [AdminSettingsService],
  exports: [AdminSettingsService],
})
export class AdminSettingsModule {}
