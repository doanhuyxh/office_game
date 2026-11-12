// Có mạng lại → tải lại trang (file riêng thay vì script inline — CSP script-src 'self').
addEventListener('online', () => location.reload());
