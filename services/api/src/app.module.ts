import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { AccessController } from './access/access.controller';
import { AccessService } from './access/access.service';
import { AdminController } from './iam/admin.controller';
import { AdminService } from './iam/admin.service';
import { GovernmentAccountService } from './iam/account.service';
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
import { CitizenSafetyService } from './identity/citizen-safety.service';
import { CitizenSecurityService } from './identity/citizen-security.service';
import { CredentialService } from './identity/credential.service';
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
import { AlertsService } from './oversight/alerts.service';
import { CorrectionsService } from './oversight/corrections.service';
import { MissingPersonsController } from './missing-persons/missing-persons.controller';
import { NotificationDeliveryWorker } from './notifications/delivery.worker';
import { NotificationOperationsService } from './notifications/operations.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { NotificationWorkerScheduler } from './notifications/worker.scheduler';
import { MissingPersonsService } from './missing-persons/missing-persons.service';
import { OversightController } from './oversight/oversight.controller';
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
    OversightController,
    AccessController,
    AuditController,
    AnalyticsController,
    IntegrationController,
    NotificationsController,
  ],
  providers: [
    ActorService,
    AuthService,
    AdminService,
    GovernmentAccountService,
    AuditService,
    PolicyService,
    PcidService,
    DuplicateDetectionService,
    CitizensService,
    Citizen360Service,
    CitizenPortalService,
    CitizenAccountService,
    CitizenSecurityService,
    CitizenSafetyService,
    CredentialService,
    RegistrationService,
    AssetsService,
    IncidentsService,
    DispatchService,
    CasesService,
    MatchingEngine,
    MissingPersonsService,
    CorrectionsService,
    AlertsService,
    AccessService,
    AnalyticsService,
    IntegrationService,
    NotificationsService,
    NotificationDeliveryWorker,
    NotificationOperationsService,
    NotificationWorkerScheduler,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
