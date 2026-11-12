using System.Net;
using OfficeHub.BuildingBlocks.Configuration;

namespace OfficeHub.BuildingBlocks.Office;

/// <summary>Kiểm tra một IP có thuộc mạng văn phòng không — dải IP lấy từ <see cref="RuntimeConfig.OfficeIps"/> (DB, chưa có thì Office__IpRanges).</summary>
public sealed class OfficeNetwork(RuntimeConfig config)
{
    public bool IsOnsite(IPAddress? ip)
    {
        if (ip is null) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        return config.OfficeIps.Networks.Any(n => n.Contains(ip));
    }
}
