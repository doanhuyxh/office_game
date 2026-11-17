import { formatFinding } from '../doctor/finding';
import type { Command } from './context';

/**
 * `run --agent NV120 --task TEST-45 [--no-model-check]`: chạy ngay một việc rồi thoát — bỏ qua Telegram nhưng vẫn hỏi lại OfficeHub
 * (việc phải đang giao cho agent). In kết quả job dạng JSON; job không `done` → mã thoát 1.
 */
export const run: Command = async ({ runner, flags }) => {
  const { agent: code, task } = flags;
  if (!code || !task) {
    console.error('Cần --agent và --task');
    return 2;
  }
  const findings = await runner.checkAgents({ only: code, telegram: false, modelCheck: flags.modelCheck });
  console.log(findings.map(formatFinding).join('\n'));
  const agent = runner.agents.get(code);
  if (!agent?.enabled) return 1;

  const found = (await agent.hub.getTask(task))?.task;
  if (!found?.id || !found.projectId || !found.code) {
    console.error(`Không đọc được việc ${task}`);
    return 1;
  }
  const result = await runner.runNow(agent, {
    kind: 'task',
    employee_code: code,
    project_id: found.projectId,
    task_id: found.id,
    task_code: found.code,
  });
  if (!result.job) {
    console.error(result.problem);
    return 1;
  }
  const { status, reason, pr_url: pr, model, cost_usd: cost } = result.job;
  console.log(JSON.stringify({ status, reason, pr, model, cost }, null, 2));
  return status === 'done' ? 0 : 1;
};
