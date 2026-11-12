/** Mode worktree: nhánh riêng cho việc, runner sẽ push + mở PR sau phiên. */

export function workStep(branch: string): string {
  return `5. Làm việc trong thư mục hiện tại: worktree riêng, nhánh ${branch}. Đọc AGENTS.md của repo và làm đúng luật trong đó (build / test phải pass).
   Commit thay đổi vào nhánh này: chỉ "git add <file>" đúng file bạn đã sửa (KHÔNG "git add -A" / "git add ."), không đổi git user.name / user.email
   (commit đứng tên tài khoản git của máy, hook tự thêm trailer Agent / Task). KHÔNG push, KHÔNG tạo PR — bộ điều phối sẽ push và mở PR.
`;
}

export const GIT_RULES = '- Không push lên main, không force push, không đổi remote, không sửa git config / hook.';
