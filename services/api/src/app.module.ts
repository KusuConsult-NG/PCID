import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { AccessController } from './access/access.controller';
import { AccessService } from './access/access.service';
import { AdminController } from './iam/admin.controller';
import { AdminService } from './iam/admin.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsService } from './analytics/analytics.service';
import { AssetsController } from './assets/assets.controller';
import { AssetsService } from './assets/assets.service';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './iam/auth.controller';
import { AuthGuard } from './iam/auth.guard';
import { AuthService } from './iam/auth.service';
import { ActorService } from './iam/actor.service';
import { CasesController } from './cases/cases.controller';
import { CasesService } from './cases/cases.service';
import { Citizen360Service } from './identity/citizen360.service';
import { CitizenPortalController } from './identity/citizen-portal.controller';
import { CitizenAccountService } from './identity/citizen-account.service';
import { CitizenPortalService } from './identity/citizen-portal.service';
import { CitizensController } from './identity/citizens.controller';
import { CitizensService } from './identity/citizens.service';
import { ConfigModule } from './config/config.module';
import { CorrelationMiddleware } from './common/correlation';
import { DatabaseModule } from './database/database.module';
import { DispatchService } from './emergency/dispatch.service';
import { DuplicateDetectionService } from './identity/duplicate-detection';
import { EmergencyController } from './emergency/emergency.controller';
import { HealthController } from './health/health.controller';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { IncidentsService } from './emergency/incidents.service';
import { IntegrationController } from './integration/integration.controller';
import { IntegrationService } from './integration/integration.service';
import { MatchingEngine } from './missing-persons/matching.engine';
import { MissingPersonsController } from './missing-persons/missing-persons.controller';
import { MissingPersonsService } from './missing-persons/missing-persons.service';
import { PcidService } from './identity/pcid.service';
import { PolicyService } from './policy/policy.service';
import { RegistrationService } from './identity/registration.service';
import { SecurityModule } from './security/security.module';

/**
 * Application composition.
 *
 * `AuthGuard` is registered globally: a route is authenticated unless it is
 * explicitly marked `@Public()`, so forgetting a guard on a new controller fails
 * closed rather than exposing it.
 */
@Module({
  imports: [ConfigModule, DatabaseModule, SecurityModule],
  controllers: [
    HealthController,
    AuthController,
    AdminController,
    CitizensController,
    CitizenPortalController,
    AssetsController,
    EmergencyController,
    CasesController,
    MissingPersonsController,
    AccessController,
    AuditController,
    AnalyticsController,
    IntegrationController,
  ],
  providers: [
    ActorService,
    AuthService,
    AdminService,
    AuditService,
    PolicyService,
    PcidService,
    DuplicateDetectionService,
    CitizensService,
    Citizen360Service,
    CitizenPortalService,
    CitizenAccountService,
    RegistrationService,
    AssetsService,
    IncidentsService,
    DispatchService,
    CasesService,
    MatchingEngine,
    MissingPersonsService,
    AccessService,
    AnalyticsService,
    IntegrationService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
