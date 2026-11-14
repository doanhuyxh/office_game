/** Mode in_place: làm ngay trong workspace thật, trên nhánh đang checkout; agent chỉ commit, bộ điều phối push nhánh đó sau phiên — không PR. */

export function workStep(branch: string): string {
  return `5. Làm việc trong thư mục hiện tại: đây là workspace THẬT của máy, đang ở nhánh ${branch} (không có worktree riêng). Đọc AGENTS.md của repo
   và làm đúng luật trong đó (build / test phải pass).
   Commit thay đổi thẳng vào nhánh ${branch}: chỉ "git add <file>" đúng file bạn đã sửa (KHÔNG "git add -A" / "git add ."), không đổi git user.name /
   user.email (commit đứng tên tài khoản git của máy). Giữ nguyên nhánh: KHÔNG checkout / switch sang nhánh khác,
   không reset / stash / rebase / merge / pull. KHÔNG tự push, KHÔNG tạo PR — sau phiên bộ điều phối sẽ push nhánh ${branch} lên origin:
   mọi commit của bạn lên remote NGAY, nên chỉ commit khi build / test đã pass.
`;
}

export const GIT_RULES = `- Không tự git push (bất kỳ nhánh nào — bộ điều phối push sau phiên), không force push, không đổi remote, không sửa git config / hook.
- Không đổi nhánh, không reset / stash / rebase / merge / pull, không xoá commit hay file của người khác: chỉ thêm commit mới của bạn vào nhánh hiện tại.`;
