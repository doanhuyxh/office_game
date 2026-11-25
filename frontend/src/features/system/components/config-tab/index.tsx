import { useTabParam } from '@/hooks/useTabParam';
import { CONFIG_SECTION_IDS, CONFIG_SECTIONS, DEFAULT_CONFIG_SECTION } from '../../utils/config-sections';
import { ConfigNav } from '../config-nav';

/**
 * Tab Cấu hình của trang Hệ thống (TEST-234): menu mục bên trái (nhóm Hạ tầng / Thông báo / Chấm công / Trợ lý AI / Tài liệu) + nội dung mục đang mở.
 * Mục lưu trên URL `?tab=config&section=smtp` (lạ → mặc định S3). Chỉ render mục đang mở → API của mục chỉ tải khi mở.
 * Danh mục mục: `utils/config-sections.tsx` (thêm cấu hình mới = thêm một dòng ở đó).
 */
export function ConfigTab() {
  const [section, setSection] = useTabParam(DEFAULT_CONFIG_SECTION, CONFIG_SECTION_IDS, { param: 'section' });
  const current = CONFIG_SECTIONS.find((s) => s.id === section) ?? CONFIG_SECTIONS[0];
  return (
    <div className="grid min-w-0 gap-4 @3xl/content:grid-cols-[14rem_minmax(0,1fr)] @3xl/content:gap-6" data-testid="config-tab">
      <ConfigNav value={current.id} onChange={setSection} />
      <section className="min-w-0" aria-label={current.label} data-testid={`config-section-${current.id}`} key={current.id}>
        {current.render()}
      </section>
    </div>
  );
}
