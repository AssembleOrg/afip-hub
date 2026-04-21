import { Module } from '@nestjs/common';
import { VentanillaService } from './ventanilla.service';
import { VentanillaController } from './ventanilla.controller';
import { VentanillaCron } from './ventanilla.cron';

@Module({
  controllers: [VentanillaController],
  providers: [VentanillaService, VentanillaCron],
  exports: [VentanillaService],
})
export class VentanillaModule {}
