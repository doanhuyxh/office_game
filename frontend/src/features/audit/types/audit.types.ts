export interface IFieldChange {
  field: string;
  old: string | null;
  new: string | null;
  masked: boolean;
}

/** Khớp ChangeDto (module Audit). source: web | ai | system. */
export interface IChange {
  id: string;
  occurredAt: string;
  source: 'web' | 'ai' | 'system';
  userId: string | null;
  userName: string | null;
  module: string;
  entity: string;
  entityId: string;
  entityLabel: string | null;
  action: 'Added' | 'Modified' | 'Deleted';
  changes: IFieldChange[];
}

export interface IChangeFilter {
  entity?: string | null;
  entityId?: string | null;
  search?: string;
}
