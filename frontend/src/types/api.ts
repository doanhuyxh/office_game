/** Lỗi theo chuẩn ProblemDetails của ASP.NET Core. */
export interface IProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: Record<string, string[]>;
}
