import type { JobKind } from '../store';
import { chatJobs } from './chat';
import { deployJobs } from './deploy';
import type { JobHandler, JobServices, WakeOf } from './handler';
import { meetingJobs } from './meeting';
import { reviewJobs } from './review';
import { taskJobs } from './task';

export type { Admission, JobHandler, JobServices } from './handler';

/** Registry loại job → handler. */
export type JobHandlers = { [K in JobKind]: JobHandler<WakeOf<K>> };

export function createJobHandlers(services: JobServices): JobHandlers {
  return {
    task: taskJobs(services),
    chat: chatJobs(services),
    meeting: meetingJobs(services),
    review: reviewJobs(services),
    deploy: deployJobs(services),
  };
}
