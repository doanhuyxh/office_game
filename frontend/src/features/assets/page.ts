// Trang (route) của feature — chỉ routes/router.tsx import file này (lazy). Không export trang qua index.ts để layout import hook / component từ barrel không kéo trang vào bundle chính.
export { AssetsPage } from './components/assets-page';
