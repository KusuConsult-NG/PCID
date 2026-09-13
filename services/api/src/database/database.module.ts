import { Global, Module } from '@nestjs/common';

import { Database } from './pool';

@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
