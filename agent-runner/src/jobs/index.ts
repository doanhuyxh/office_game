import type { Wake } from '../validator';
import { chatJobs } from './chat';
import { followJobs } from './follow';
import type { JobHandler, JobServices, WakeOf } from './handler';
import { meetingJobs } from './meeting';
import { taskJobs } from './task';

export type { Admission, JobHandler, JobServices } from './handler';

/** Registry loại job → handler (job loại cũ review / deploy trong DB chạy bằng handler follow — `currentKind` ở `store.ts`). */
export type JobHandlers = { [K in Wake['kind']]: JobHandler<WakeOf<K>> };

export function createJobHandlers(services: JobServices): JobHandlers {
  return {
    task: taskJobs(services),
    chat: chatJobs(services),
    meeting: meetingJobs(services),
    follow: followJobs(services),
  };
}
