// Public API của module Tài sản công ty (thiết bị + dịch vụ / tài khoản phần mềm).
export { AssetsPage } from './components/assets-page';
export { EmployeeHoldings, EmployeeHoldingsDialog } from './components/employee-holdings';
export { useHoldings, useMyAssets } from './hooks/useAssets';
export type { IHoldings, IHeldDevice, IHeldSeat } from './types/asset.types';
