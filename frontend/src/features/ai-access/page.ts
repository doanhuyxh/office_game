// Trang (route) của feature — chỉ routes/router.tsx import file này (lazy). Không export trang qua index.ts để layout import hook / component từ barrel không kéo trang vào bundle chính.
export { AiAccessPage } from './components/ai-access-page';
export { OAuthConsentPage } from './components/oauth-consent-page';
