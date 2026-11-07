namespace OfficeHub.Realtime.Simulation;

public static class RoomLookup
{
    /// <summary>Phòng có tường người chơi đang đứng (null = khu mở). Quy tắc chung của chat, voice và màn hình phòng.</summary>
    public static Room? WallRoomOf(this OfficeMap map, Player p)
    {
        float x, z;
        lock (p) { x = p.X; z = p.Z; }
        return map.Rooms.FirstOrDefault(r => r.Walls && r.Contains(x, z));
    }
}
