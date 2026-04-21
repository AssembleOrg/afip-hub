import { Global, Module } from '@nestjs/common';
import { UsageService } from './usage.service';
import { RateLimiterService } from './rate-limiter.service';

@Global()
@Module({
  providers: [UsageService, RateLimiterService],
  exports: [UsageService, RateLimiterService],
})
export class UsageModule {}
