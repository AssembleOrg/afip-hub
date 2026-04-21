import { Global, Module } from '@nestjs/common';
import { AddOnsService } from './addons.service';
import { AddOnSubscriptionsService } from './addon-subscriptions.service';
import { AddOnsController } from './addons.controller';

@Global()
@Module({
  controllers: [AddOnsController],
  providers: [AddOnsService, AddOnSubscriptionsService],
  exports: [AddOnsService, AddOnSubscriptionsService],
})
export class AddOnsModule {}
