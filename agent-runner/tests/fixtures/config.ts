// Cấu hình mẫu hợp lệ cho test (không phải token thật).
export const TG = '123456789:AAH-test-token-abcdefghijklmnopqrstu';
export const baseRaw = () => ({
  officehub: { mcp_url: 'http://localhost:5200/mcp' },
  telegram: { group_chat_id: '-1001234567890', notifier_bot: '@OfficeHub_Notify_Bot' },
  runner: { data_dir: '/var/lib/r', worktrees_dir: '/srv/agents/worktrees', max_parallel: 2 },
  agents: [
    {
      employee_code: 'nv120',
      telegram_bot: 'Agent_Dev01_Bot',
      telegram_token: TG,
      token: 'ohk_abcdefgh12345678',
      projects: [{ project: 'TEST', repo: '/srv/agents/NV120/office_game' }],
      executor: { kind: 'claude', bin: '/usr/local/bin/claude', model: 'claude-sonnet-5-5', max_budget_usd: 5 },
    },
  ],
});
