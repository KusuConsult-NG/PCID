import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { DevicePlatform, DeviceRevocationReason } from '@pcid/contracts';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import { deviceRegistrationSchema, deviceRevocationSchema } from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { DevicesService } from './devices.service';
import { OfflineService } from './offline.service';

documentRoute({
  method: 'post',
  path: '/api/v1/me/devices',
  tag: 'Devices',
  summary: 'Register the device this request came from',
  description:
    'Returns a device secret, once. Present it as `x-device-token` on requests that take ' +
    'something offline. The secret authenticates nothing on its own: it travels with an ' +
    'ordinary authenticated session and says only which registered device that session is being ' +
    'used from, so that what the device holds can be bounded and taken back (§56).',
  body: deviceRegistrationSchema,
  actions: ['OFFLINE_ACCESS'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/me/devices',
  tag: 'Devices',
  summary: 'The devices registered to this account',
  description:
    'Including the ones that have been signed out, and when. A person looking for a phone they ' +
    'no longer have needs to see that it is gone as much as they need to see the ones that are not.',
  actions: ['OFFLINE_ACCESS'],
});
documentRoute({
  method: 'delete',
  path: '/api/v1/me/devices/:deviceId',
  tag: 'Devices',
  summary: 'Sign a device out and invalidate what it was holding',
  description:
    'Ends the device, revokes the sessions opened on it, and marks every offline release it held ' +
    'as invalid. The device erases its copy when it next reaches the network; until then what it ' +
    'holds is ciphertext with an expiry of its own, which is why bundles are short-lived and ' +
    'minimal rather than merely revocable.',
  parameters: [{ name: 'deviceId', in: 'path', description: 'The device to sign out.' }],
  body: deviceRevocationSchema,
  actions: ['OFFLINE_ACCESS'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/me/offline-card',
  tag: 'Devices',
  summary: 'A resident’s own Plateau Citizen ID, for a device with no coverage',
  description:
    'The identifier and the name printed on it. Deliberately not the record: a resident who ' +
    'wants their address or their emergency contacts reads them in the portal, online, where the ' +
    'access is decided and logged.',
  actions: ['OFFLINE_ACCESS'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/incidents/:reference/offline-bundle',
  tag: 'Devices',
  summary: 'The people attached to an incident, for a crew about to lose signal',
  description:
    'Each person in the bundle is produced by the ordinary emergency-profile path, authorised ' +
    'and audited one at a time, so the bundle cannot contain anything its holder could not have ' +
    'read on screen. The responder does not choose who is in it: it covers exactly those already ' +
    'attached to the incident. An incident that is not live authorises nothing, here as anywhere.',
  parameters: [{ name: 'reference', in: 'path', description: 'Incident number.' }],
  actions: ['OFFLINE_ACCESS', 'EMERGENCY_PROFILE_VIEW'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/me/offline-releases/:releaseId',
  tag: 'Devices',
  summary: 'Whether a device may still hold a bundle',
  description:
    'What a client asks the moment it reaches the network again. An unknown release, a revoked ' +
    'device and an expired bundle all answer the same way — stop holding it — because a client ' +
    'that cannot tell them apart behaves correctly for all three.',
  parameters: [{ name: 'releaseId', in: 'path', description: 'The release to ask about.' }],
  actions: ['OFFLINE_ACCESS'],
});

@Controller('api/v1')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly offline: OfflineService,
  ) {}

  @Post('me/devices')
  async register(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(deviceRegistrationSchema, body);
    return this.devices.register(
      actor,
      { label: input.label, platform: input.platform as DevicePlatform },
      contextOf(request),
    );
  }

  @Get('me/devices')
  async list(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<unknown> {
    return { devices: await this.devices.list(actor, contextOf(request)) };
  }

  @Delete('me/devices/:deviceId')
  async revoke(
    @Actor() actor: AuthenticatedActor,
    @Param('deviceId') deviceId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(deviceRevocationSchema, body ?? {});
    return this.devices.revoke(
      actor,
      deviceId,
      input.reason as DeviceRevocationReason,
      contextOf(request),
    );
  }

  @Get('me/offline-card')
  async citizenCard(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<unknown> {
    return this.offline.citizenCard(actor, contextOf(request));
  }

  @Get('incidents/:reference/offline-bundle')
  async incidentBundle(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.offline.incidentProfiles(actor, reference, contextOf(request));
  }

  @Get('me/offline-releases/:releaseId')
  async releaseStanding(
    @Actor() actor: AuthenticatedActor,
    @Param('releaseId') releaseId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.offline.releaseStanding(actor, releaseId, contextOf(request));
  }
}
