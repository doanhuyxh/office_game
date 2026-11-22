// Trang (route) của feature — chỉ routes/router.tsx import file này (lazy). Không export trang qua index.ts để layout import hook / component từ barrel không kéo trang vào bundle chính.
// Mỗi nền tảng một trang (TEST-207): /social/facebook · /social/zalo-oa · /social/tiktok.
export { FacebookPostsPage } from './components/facebook-posts-page';
export { FacebookPageDetailPage } from './components/facebook-page-detail';
export { TiktokPage, ZaloOaPage } from './components/unsupported-platform-page';
