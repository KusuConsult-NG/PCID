import { Global, Module } from '@nestjs/common';

import { loadEnv } from './env';
import type { Env } from './env';

export const ENV = Symbol('PCID_ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
