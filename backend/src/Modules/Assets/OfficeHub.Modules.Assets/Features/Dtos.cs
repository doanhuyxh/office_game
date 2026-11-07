using OfficeHub.Modules.Assets.Domain;

namespace OfficeHub.Modules.Assets.Features;

public sealed record CategoryDto(Guid Id, string Code, string Name, int SortOrder, bool IsActive);
public sealed record CategoryRequest(string? Code, string? Name, int SortOrder, bool IsActive);

public sealed record DeviceDto(Guid Id, string Code, Guid CategoryId, string CategoryName, string Name, string? Brand, string? Model,
    string? SerialNumber, DateOnly? PurchaseDate, decimal? PurchasePrice, DateOnly? WarrantyUntil, DeviceStatus Status, string? StatusReason,
    Guid? HolderEmployeeId, string? HolderName, string? HolderCode, string? Note, DateTimeOffset CreatedAt);

public sealed record AssignmentDto(Guid Id, Guid EmployeeId, string EmployeeName, string EmployeeCode, DateTimeOffset AssignedAt,
    string? AssignedByName, string? AssignNote, DateTimeOffset? ReturnedAt, string? ReturnedByName, string? ReturnNote);

public sealed record DeviceDetailDto(DeviceDto Device, IReadOnlyList<AssignmentDto> History);

public sealed record DeviceRequest(Guid? CategoryId, string? Name, string? Brand, string? Model, string? SerialNumber, DateOnly? PurchaseDate,
    decimal? PurchasePrice, DateOnly? WarrantyUntil, string? Note);
public sealed record AssignRequest(Guid? EmployeeId, string? Note);
public sealed record ReturnRequest(string? Note);
public sealed record StatusRequest(DeviceStatus Status, string? Reason);

public sealed record ServiceDto(Guid Id, string Name, string? Vendor, string? Plan, string? Url, int? SeatLimit, int SeatsUsed, BillingCycle BillingCycle,
    decimal? Cost, DateOnly? RenewalDate, Guid? OwnerDepartmentId, string? OwnerDepartmentName, Guid? AdminEmployeeId, string? AdminName,
    ServiceStatus Status, string? Note);
public sealed record ServiceRequest(string? Name, string? Vendor, string? Plan, string? Url, int? SeatLimit, BillingCycle BillingCycle, decimal? Cost,
    DateOnly? RenewalDate, Guid? OwnerDepartmentId, Guid? AdminEmployeeId, string? Note);

public sealed record SeatDto(Guid Id, Guid ServiceId, string ServiceName, Guid EmployeeId, string EmployeeName, string EmployeeCode, string AccountLogin,
    string? Role, string? Note, DateTimeOffset GrantedAt, string? GrantedByName, DateTimeOffset? RevokedAt, string? RevokedByName);
public sealed record GrantSeatRequest(Guid? EmployeeId, string? AccountLogin, string? Role, string? Note);

public sealed record HeldDeviceDto(Guid Id, string Code, string Name, string CategoryName, string? SerialNumber, DateTimeOffset AssignedAt);
public sealed record HeldSeatDto(Guid Id, Guid ServiceId, string ServiceName, string AccountLogin, string? Role, string? Url, DateTimeOffset GrantedAt);
public sealed record HoldingsDto(IReadOnlyList<HeldDeviceDto> Devices, IReadOnlyList<HeldSeatDto> Seats);

public sealed record WarrantyDueDto(Guid Id, string Code, string Name, DateOnly WarrantyUntil, string? HolderName);
public sealed record RenewalDueDto(Guid Id, string Name, DateOnly RenewalDate);
public sealed record ResignedHoldingDto(Guid EmployeeId, string Code, string FullName, DateOnly? LeftAt, int Devices, int Seats);
public sealed record OverviewDto(IReadOnlyDictionary<string, int> DeviceCounts, int DeviceTotal, decimal TotalPurchaseValue, int ActiveServices,
    decimal MonthlyServiceCost, int SeatsInUse, IReadOnlyList<WarrantyDueDto> WarrantiesDue, IReadOnlyList<RenewalDueDto> RenewalsDue,
    IReadOnlyList<ResignedHoldingDto> ResignedHolding);

public sealed record ReviewDto(Guid Id, string Title, ReviewStatus Status, DateOnly DueDate, DateTimeOffset StartedAt, string? StartedByName,
    DateTimeOffset? ClosedAt, int Total, int Decided, int ToRevoke);
public sealed record ReviewItemDto(Guid Id, Guid ReviewId, string ReviewTitle, Guid SeatId, string ServiceName, string AccountLogin, Guid EmployeeId,
    string EmployeeName, string EmployeeCode, Guid? ReviewerEmployeeId, string? ReviewerName, ReviewDecision Decision, string? Note,
    DateTimeOffset? DecidedAt, string? DecidedByName);
public sealed record ReviewDetailDto(ReviewDto Review, IReadOnlyList<ReviewItemDto> Items);
public sealed record ReviewStartRequest(string? Title, DateOnly? DueDate, Guid? ServiceId);
public sealed record DecideRequest(ReviewDecision Decision, string? Note);

public sealed record StocktakeDto(Guid Id, string Title, ReviewStatus Status, DateTimeOffset StartedAt, string? StartedByName, DateTimeOffset? ClosedAt,
    int Total, int Checked, int Missing);
public sealed record StocktakeItemDto(Guid Id, Guid DeviceId, string DeviceCode, string DeviceName, string? SerialNumber, string? ExpectedHolderName,
    StocktakeResult Result, string? Note, DateTimeOffset? CheckedAt, string? CheckedByName);
public sealed record StocktakeDetailDto(StocktakeDto Stocktake, IReadOnlyList<StocktakeItemDto> Items);
public sealed record StocktakeStartRequest(string? Title);
public sealed record StocktakeCheckRequest(StocktakeResult Result, string? Note);
public sealed record StocktakeCloseRequest(bool MarkMissingAsLost);
