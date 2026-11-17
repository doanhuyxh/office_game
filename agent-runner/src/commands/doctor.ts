import { formatFinding, hasFailure } from '../doctor/finding';
import type { Command } from './context';

/** `doctor [--agent NV120] [--no-telegram] [--no-model-check]`: kiểm tra cấu hình từng agent, in kết quả; có dòng ✘ → mã thoát 1. */
export const doctor: Command = async ({ runner, flags }) => {
  const findings = await runner.checkAgents({
    only: flags.agent,
    telegram: flags.telegram,
    modelCheck: flags.modelCheck,
  });
  console.log(findings.map(formatFinding).join('\n'));
  return hasFailure(findings) ? 1 : 0;
};
