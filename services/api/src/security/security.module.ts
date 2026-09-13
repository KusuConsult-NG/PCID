import { Global, Module } from '@nestjs/common';

import { CryptoService } from './crypto.service';
import { PasswordService } from './password.service';
import { RateLimiter } from './rate-limit';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

@Global()
@Module({
  providers: [PasswordService, CryptoService, TotpService, TokenService, RateLimiter],
  exports: [PasswordService, CryptoService, TotpService, TokenService, RateLimiter],
})
export class SecurityModule {}
