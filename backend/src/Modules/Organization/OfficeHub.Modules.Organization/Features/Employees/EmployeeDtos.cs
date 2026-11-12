using OfficeHub.Modules.Identity.Contracts;

namespace OfficeHub.Modules.Organization.Features.Employees;

/// <summary>
/// Một dòng danh bạ. Status / JoinedAt / LeftAt là thông tin nhân sự: null khi người xem không phải HR, chính chủ hay quản lý
/// (trực tiếp / gián tiếp) của nhân viên đó — xem <see cref="EmployeeEndpoints.HrFieldsVisibilityAsync"/>.
/// </summary>
public sealed record EmployeeListItem(
    Guid Id, string Code, string FullName, string? Email, string? Phone,
    Guid? DepartmentId, string? DepartmentName, Guid? PositionId, string? PositionName, int? PositionLevel, string? JobTitle,
    Guid? ManagerId, string? ManagerName, string? Status, DateOnly? JoinedAt, DateOnly? LeftAt,
    Guid? UserId, AccountSummary? Account, string? AvatarUrl = null);

/// <summary>Tóm tắt tài khoản đăng nhập (chỉ HR / chính chủ thấy).</summary>
public sealed record AccountSummary(string UserName, IReadOnlyList<string> Roles, bool IsActive, bool MustChangePassword,
    bool InvitePending, DateTimeOffset? LastLoginAt, bool TwoFactorEnabled = false, bool IsBot = false, string? TelegramBot = null)
{
    public static AccountSummary From(AccountInfo a) =>
        new(a.UserName, a.Roles, a.IsActive, a.MustChangePassword, a.InvitePending, a.LastLoginAt, a.TwoFactorEnabled, a.IsBot, a.TelegramBot);
}

public sealed record EmployeeDetail(EmployeeListItem Employee, DateOnly? DateOfBirth, string? Note, int SubordinateCount);

public sealed record UpsertEmployeeRequest(
    string? Code, string FullName, string? Email, string? Phone, DateOnly? DateOfBirth,
    Guid? DepartmentId, Guid? PositionId, Guid? ManagerId, string? Status, DateOnly JoinedAt, string? Note, string? JobTitle = null);

public sealed record ResignRequest(DateOnly LeftAt);

/// <summary>mode = "invite" (gửi email mời) hoặc "password" (HR cấp mật khẩu tạm).</summary>
public sealed record CreateAccountRequest(string Mode, string? UserName, string[]? Roles);

public sealed record SetRolesRequest(string[] Roles);

/// <summary>true = tài khoản do bot vận hành (hiện trong văn phòng 3D khi gọi MCP).</summary>
public sealed record SetBotRequest(bool IsBot);

/// <summary>Username bot Telegram của agent (vd "@agent_dev01_bot"); trống / null = xoá (TEST-42).</summary>
public sealed record SetTelegramBotRequest(string? TelegramBot);

/// <summary>Trả về mật khẩu tạm MỘT LẦN để HR đưa cho nhân viên (không lưu ở đâu khác).</summary>
public sealed record AccountCreatedResponse(Guid UserId, string UserName, string? TempPassword, bool InviteSent);

public sealed record TempPasswordResponse(string TempPassword);

public sealed record NextCodeResponse(string Code);
