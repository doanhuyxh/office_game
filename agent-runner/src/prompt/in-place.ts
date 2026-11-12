/** Mode in_place: làm ngay trong workspace thật, trên nhánh đang checkout; chỉ commit, không push, không PR. */

export function workStep(branch: string): string {
  return `5. Làm việc trong thư mục hiện tại: đây là workspace THẬT của máy, đang ở nhánh ${branch} (không có worktree riêng). Đọc AGENTS.md của repo
   và làm đúng luật trong đó (build / test phải pass).
   Commit thay đổi thẳng vào nhánh ${branch}: chỉ "git add <file>" đúng file bạn đã sửa (KHÔNG "git add -A" / "git add ."), không đổi git user.name /
   user.email (commit đứng tên tài khoản git của máy). Giữ nguyên nhánh: KHÔNG checkout / switch sang nhánh khác,
   không reset / stash / rebase / merge / pull. KHÔNG push, KHÔNG tạo PR — người thật xem lại commit trên máy rồi tự push.
`;
}

export const GIT_RULES = `- Không git push (bất kỳ nhánh nào), không force push, không đổi remote, không sửa git config / hook.
- Không đổi nhánh, không reset / stash / rebase / merge / pull, không xoá commit hay file của người khác: chỉ thêm commit mới của bạn vào nhánh hiện tại.`;
