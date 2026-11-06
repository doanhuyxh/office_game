import { useQuery } from '@tanstack/react-query';
import { reportApi, reportKeys } from '../api/report.api';

export const useOvertimePay = (month: string) => useQuery({ queryKey: reportKeys.overtimePay(month), queryFn: () => reportApi.overtimePay(month) });
export const useLeavePayout = () => useQuery({ queryKey: reportKeys.leavePayout, queryFn: reportApi.leavePayout });
/** Tiền phép ước tính của tôi (nếu nghỉ việc hôm nay). 404 khi chưa có hồ sơ nhân viên → không retry. */
export const useMyLeavePayout = () => useQuery({ queryKey: reportKeys.myLeavePayout, queryFn: reportApi.myLeavePayout, retry: false });
