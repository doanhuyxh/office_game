using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Assets.Contracts;
using OfficeHub.Modules.Assets.Domain;

namespace OfficeHub.Modules.Assets.Infrastructure;

/// <summary>Cài đặt <see cref="IServiceRenewals"/> (dự báo dòng tiền, TEST-221): lọc theo <see cref="AssetRules.HasRenewalCost"/>.</summary>
internal sealed class ServiceRenewals(AssetsDbContext db) : IServiceRenewals
{
    public async Task<IReadOnlyList<ServiceRenewal>> ActiveRenewalsAsync(CancellationToken ct = default)
    {
        var rows = await db.Services.AsNoTracking()
            .Where(s => s.Status == ServiceStatus.Active && s.BillingCycle != BillingCycle.None && s.Cost > 0 && s.RenewalDate != null)
            .OrderBy(s => s.RenewalDate).ThenBy(s => s.Name).ToListAsync(ct);
        return [.. rows.Where(s => AssetRules.HasRenewalCost(s.Status, s.BillingCycle, s.Cost, s.RenewalDate))
            .Select(s => new ServiceRenewal(s.Id, s.Name, s.Vendor, s.BillingCycle.ToString(), AssetRules.CostVnd(s.Cost!.Value), s.RenewalDate!.Value))];
    }
}
