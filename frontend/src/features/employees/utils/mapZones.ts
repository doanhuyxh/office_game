import map from '@shared/office-map.json';

/**
 * Khu có thể gán cho phòng ban (departments.MapZone) trên bản đồ v2: khu phòng ban trong khu mở (areas),
 * phòng làm việc riêng (rooms kind office), sảnh lễ tân, và khu làm việc chung. Không gồm phòng họp / pantry / khu nghỉ.
 */
export const MAP_ZONES: { id: string; name: string }[] = (() => {
  const list = [
    ...map.areas.map((a) => ({ id: a.id, name: a.name })),
    ...map.rooms.filter((r) => ['office', 'lobby', 'open'].includes(r.kind)).map((r) => ({ id: r.zone, name: r.name })),
  ];
  return list.filter((z, i) => list.findIndex((x) => x.id === z.id) === i);
})();

export const mapZoneName = (id: string | null | undefined) => MAP_ZONES.find((z) => z.id === id)?.name;
