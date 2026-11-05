using System.Net;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;

namespace OfficeHub.BuildingBlocks.Office;

/// <summary>Kiểm tra một IP có thuộc mạng văn phòng không (theo Office__IpRanges).</summary>
public sealed class OfficeNetwork(IOptions<OfficeSettings> options)
{
    private readonly IPNetwork[] _networks = options.Value.IpRanges
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(IPNetwork.Parse)
        .ToArray();

    public bool IsOnsite(IPAddress? ip)
    {
        if (ip is null) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        return _networks.Any(n => n.Contains(ip));
    }
}
