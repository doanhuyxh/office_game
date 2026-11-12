import { Component, type ReactNode } from 'react';
import { ErrorPage } from '../error-page';

/**
 * Error boundary gốc bọc cả app ở main.tsx (TEST-67): bắt lỗi ngoài router (khởi tạo provider, App…) → cùng trang lỗi toàn màn hình.
 * Lỗi trong màn hình đã có errorComponent của router (routes/router.tsx).
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('Lỗi không xác định') };
  }

  render() {
    return this.state.error ? <ErrorPage error={this.state.error} fullScreen /> : this.props.children;
  }
}
