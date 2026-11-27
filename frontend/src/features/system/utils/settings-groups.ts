import type { ISettingsGroup, SettingsGroupKey } from '../types/system.types';

/** Nhóm bảo mật / chung (công ty): không có .env, không có bước kiểm tra (khớp `SettingsGroups.DefaultsOnly` ở back-end). */
const DEFAULT_ONLY_GROUPS: SettingsGroupKey[] = ['two_factor', 'session', 'password', 'company'];

/** Nhóm chỉ có giá trị mặc định trong code (chưa lưu = mặc định, xoá = về mặc định). */
export const isDefaultsGroup = (g: ISettingsGroup) => g.source === 'default' || DEFAULT_ONLY_GROUPS.includes(g.group);
