// Phân trang cho bảng danh sách: trạng thái trang ở FE, dữ liệu do BE cắt trang (`?page=&pageSize=` → `IPaged<T>`).
export { TablePagination } from './TablePagination';
export { usePageState, PAGE_SIZES, DEFAULT_PAGE_SIZE, type PageState } from './usePageState';
