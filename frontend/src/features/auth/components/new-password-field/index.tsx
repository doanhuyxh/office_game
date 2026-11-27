import { FormField } from '@/components/common/FormField';
import { usePasswordPolicy } from '../../hooks/useAuth';

/**
 * Ô "Mật khẩu mới" theo chính sách mật khẩu hiện hành (TEST-260): nhãn ghi quy tắc, `minLength` theo độ dài tối thiểu.
 * Back-end vẫn là nơi kiểm tra (lỗi trả về hiện ở form cha); chưa tải được chính sách → nhãn chung.
 */
export function NewPasswordField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const { data: policy } = usePasswordPolicy();
  return (
    <FormField id="next" label={policy ? `Mật khẩu mới (${policy.description})` : 'Mật khẩu mới'} type="password" required
      minLength={policy?.minLength ?? 8} autoFocus={autoFocus} autoComplete="new-password"
      value={value} onChange={(e) => onChange(e.target.value)} data-testid="new-password" />
  );
}
