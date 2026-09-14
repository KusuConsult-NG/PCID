import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import { notificationQueueSchema, notificationRetrySchema } from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { NotificationOperationsService } from './operations.service';

documentRoute({
  method: 'get',
  path: '/api/v1/notifications/queue',
  tag: 'Administration',
  summary: 'The state of the notification delivery queue',
  description:
    'Counts by status and channel, the oldest thing still waiting, and the messages that were ' +
    'abandoned. It returns no message bodies and no recipient addresses: an operations view of a ' +
    'delivery queue does not need to read anybody’s post, and a screen that showed it would be a ' +
    'second copy of the inbox with none of the controls on the first.',
  parameters: [
    { name: 'channel', in: 'query', description: 'Restrict to one channel.' },
    { name: 'status', in: 'query', description: 'Restrict to one status.' },
  ],
  actions: ['ADMIN_SYSTEM_MANAGE'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/notifications/:notificationId/retry',
  tag: 'Administration',
  summary: 'Put an abandoned message back on the queue',
  description:
    'For after the gateway was fixed. It resets the attempt counter and makes the message due ' +
    'now; it does not change a single character of what will be sent, because what was sent is ' +
    'what the template decided when the message was raised.',
  parameters: [{ name: 'notificationId', in: 'path', description: 'Notification id.' }],
  body: notificationRetrySchema,
  actions: ['ADMIN_SYSTEM_MANAGE'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/notifications/sweep',
  tag: 'Administration',
  summary: 'Run one delivery sweep now',
  description:
    'The worker runs on its own schedule. This is for an operator who has just fixed something ' +
    'and does not want to wait for the next tick.',
  actions: ['ADMIN_SYSTEM_MANAGE'],
});

@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(private readonly operations: NotificationOperationsService) {}

  @Get('queue')
  async queue(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(notificationQueueSchema, query);
    return this.operations.queue(
      actor,
      {
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      contextOf(request),
    );
  }

  @Post('sweep')
  async sweep(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<unknown> {
    return this.operations.sweepNow(actor, contextOf(request));
  }

  @Post(':notificationId/retry')
  async retry(
    @Actor() actor: AuthenticatedActor,
    @Param('notificationId') notificationId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(notificationRetrySchema, body);
    return this.operations.retry(actor, notificationId, input.note, contextOf(request));
  }
}
