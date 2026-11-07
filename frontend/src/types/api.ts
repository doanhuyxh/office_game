/** Lỗi theo chuẩn ProblemDetails của ASP.NET Core. */
export interface IProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: Record<string, string[]>;
}

/** Một trang danh sách (BE `PagedResult<T>`): endpoint danh sách trả dạng này khi gọi kèm `page` (`pageQs`). */
export interface IPaged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Tham số phân trang gửi lên API (page 1-based; pageSize ≤ 200). */
export interface IPageQuery {
  page: number;
  pageSize: number;
}
