using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Hosting;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.Modules.Approval;
using OfficeHub.Modules.Attendance;
using OfficeHub.Modules.Audit;
using OfficeHub.Modules.LaborContracts;
using OfficeHub.Modules.Identity;
using OfficeHub.Modules.Leave;
using OfficeHub.Modules.Notification;
using OfficeHub.Modules.Organization;
using OfficeHub.Modules.Reporting;
using Scalar.AspNetCore;

EnvLoader.Load();
var builder = WebApplication.CreateBuilder(args);
builder.AddOfficeHubDefaults("officehub-api");

builder.Services.AddOfficeHubFileStorage(builder.Configuration);
builder.Services.AddOfficeHubEmail(builder.Configuration);
builder.Services.AddOfficeHubAuthorization();
builder.Services.AddOpenApi();

// Thêm module mới: tạo project trong src/Modules rồi thêm vào danh sách này.
IModule[] modules =
[
    new IdentityModule(),
    new OrganizationModule(),
    new AttendanceModule(),
    new LeaveModule(),
    new LaborContractsModule(),
    new ApprovalModule(),
    new NotificationModule(),
    new ReportingModule(),
    new AuditModule(),
];
foreach (var m in modules) m.Register(builder.Services, builder.Configuration);

var app = builder.Build();
app.UseOfficeHubDefaults();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();                 // /openapi/v1.json → FE sinh client bằng Orval
    app.MapScalarApiReference();      // /scalar → giao diện thử API
}

var api = app.MapGroup("/api");
foreach (var m in modules) m.MapEndpoints(api);

app.Run();

public partial class Program;
