import { useMutation, useQuery } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import { agentTranscriptApi, agentTranscriptKeys } from '../api/agentTranscript.api';
import type { IAgentTranscript, IAgentTranscriptFilter } from '../types/agentTranscript.types';

export const useAgentTranscripts = (f: IAgentTranscriptFilter, q: IPageQuery) =>
  useQuery({ queryKey: agentTranscriptKeys.list(f, q), queryFn: () => agentTranscriptApi.list(f, q), placeholderData: (prev) => prev });

/** Tải một transcript — `variables.id` để chỉ nút của dòng được bấm xoay. */
export const useDownloadAgentTranscript = () =>
  useMutation({ mutationFn: (t: Pick<IAgentTranscript, 'id' | 'kind' | 'key'>) => agentTranscriptApi.download(t) });
