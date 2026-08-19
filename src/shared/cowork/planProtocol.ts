export const PlanControlAction = {
  Start: 'start',
  Approve: 'approve',
  Cancel: 'cancel',
  Status: 'status',
} as const;

export type PlanControlAction = typeof PlanControlAction[keyof typeof PlanControlAction];

export type PlanControl = {
  action: PlanControlAction;
  planId?: string;
  planHash?: string;
  revision?: number;
};

export type PlanControlState = {
  status: 'off' | 'planning' | 'awaiting_approval' | 'executing' | 'completed';
  planId?: string;
  planText?: string;
  planHash?: string;
  revision: number;
  updatedAt: number;
};

export const PLAN_CONTROL_GATEWAY_METHOD = 'popi.plan.control';
