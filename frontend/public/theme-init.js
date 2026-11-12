// Áp theme trước khi React tải để không nháy màu (khớp src/context/theme-provider.tsx). Nạp đồng bộ trong <head> của index.html.
try {
  var t = localStorage.getItem('officehub:theme') || 'system';
  if (t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.classList.add('dark');
} catch (e) {}
