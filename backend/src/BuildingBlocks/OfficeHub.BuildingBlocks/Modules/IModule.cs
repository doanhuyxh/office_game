using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace OfficeHub.BuildingBlocks.Modules;

/// <summary>
/// Mỗi module nghiệp vụ (Identity, Leave, Attendance...) tự đăng ký service và endpoint của nó.
/// Host chỉ việc liệt kê module, không biết chi tiết bên trong.
/// </summary>
public interface IModule
{
    /// <summary>Tên module, cũng là tiền tố route: /api/{Name}/...</summary>
    string Name { get; }
    void Register(IServiceCollection services, IConfiguration config);
    void MapEndpoints(IEndpointRouteBuilder api);
}
