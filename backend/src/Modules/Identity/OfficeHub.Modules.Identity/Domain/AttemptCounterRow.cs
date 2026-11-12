namespace OfficeHub.Modules.Identity.Domain;

/// <summary>
/// Bộ đếm theo khoá trong cửa sổ thời gian (TEST-27): đăng nhập sai theo tài khoản + IP / theo tài khoản, email quên mật khẩu theo địa chỉ.
/// Lưu DB (không RAM) → giữ qua khởi động lại, dùng chung khi chạy nhiều instance Api. Dòng hết hạn được dọn dần.
/// </summary>
public sealed class AttemptCounterRow
{
    /// <summary>Vd "s|{userId}|{ip}", "a|{userId}", "forgot|{email}" — ≤ 300 ký tự.</summary>
    public string Key { get; set; } = "";
    public int Count { get; set; }
    /// <summary>Hết cửa sổ (cửa sổ tính từ lần đầu).</summary>
    public DateTimeOffset Until { get; set; }
}
