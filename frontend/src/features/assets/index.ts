// Public API của module Tài sản công ty (thiết bị + dịch vụ / tài khoản phần mềm).
export { EmployeeHoldings, EmployeeHoldingsDialog } from './components/employee-holdings';
export { useHoldings, useMyAssets } from './hooks/useAssets';
export type { IHoldings, IHeldDevice, IHeldSeat } from './types/asset.types';
export { FACEBOOK_PLATFORM, PLATFORM_UNSUPPORTED, SOCIAL_PLATFORMS, unsupportedPlatformNames } from './utils/labels';
export type { SocialPlatformInfo } from './utils/labels';
