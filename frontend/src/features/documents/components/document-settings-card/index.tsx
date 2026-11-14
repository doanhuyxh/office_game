import { useEffect, useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsFormFooter } from '@/components/common/settings-form-footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Checkbox } from '@/components/common/checkbox';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { documentApi } from '../../api/document.api';
import { useDocMutation, useDocumentSettings } from '../../hooks/useDocuments';

/**
 * "Tài liệu: duyệt trước khi ban hành" (trang Hệ thống → Cấu hình, TEST-111). Tắt (mặc định) → tải lên là Ban hành ngay; bật → Nháp → gửi duyệt.
 * Chỉ admin — back-end (`AuthPolicies.Admin`) trả 403 cho người khác. Đổi cấu hình không ảnh hưởng tài liệu đã có / đơn đang chờ duyệt.
 */
export function DocumentSettingsCard() {
  const { data, isLoading, error } = useDocumentSettings();
  const [on, setOn] = useState(false);
  const save = useDocMutation(documentApi.saveSettings);
  useEffect(() => { if (data) setOn(data.requirePublishApproval); }, [data]);
  if (isLoading) return <Spinner />;
  if (error || !data) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  return (
    <Card data-testid="document-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><FileCheck2 className="size-4 text-muted-foreground" />Tài liệu: duyệt trước khi ban hành</CardTitle>
        <CardDescription>
          Tắt: file tải lên kho tài liệu được ban hành ngay (có số hiệu, tính hạn lưu trữ); người tải vẫn thay file / xoá được nếu tải nhầm.
          Bật: tải lên là Nháp, phải gửi duyệt mới ban hành. Đổi cấu hình không ảnh hưởng tài liệu đã có và đơn đang chờ duyệt.
          Tài liệu do trợ lý AI tạo luôn qua người duyệt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault();
          save.mutate(on, {
            onSuccess: () => toast.success(on ? 'Đã bật duyệt trước khi ban hành' : 'Đã tắt duyệt — tải lên là ban hành luôn'),
            onError: (err) => toast.error(errorMessage(err)),
          });
        }}>
          <div className="grid max-w-xl gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox id="doc-require-approval" checked={on} onCheckedChange={(v) => setOn(v === true)} />
              Bắt buộc duyệt trước khi ban hành tài liệu
            </label>
          </div>
          <SettingsFormFooter saveDisabled={save.isPending || on === data.requirePublishApproval} noteTestId="document-settings-updated"
            note={data.isDefault ? 'Đang dùng mặc định (tắt).' : `Sửa lần cuối ${data.updatedAt ? formatDateTime(data.updatedAt) : ''}${data.updatedByName ? ` bởi ${data.updatedByName}` : ''}.`} />
        </form>
      </CardContent>
    </Card>
  );
}
