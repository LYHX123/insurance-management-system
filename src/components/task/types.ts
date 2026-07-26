export type TaskCategorySlug = "daily" | "motor-claim" | "non-motor-claim";
export type TaskStatusValue = "ACTIVE" | "COMPLETED";

export type TaskListItem = {
  id: string;
  title: string;
  status: TaskStatusValue;
  createdByName: string;
  createdAt: string;
  participantNames: string[];
};

export type TaskParticipantRow = {
  userId: string;
  fullName: string;
  role: string | null;
  isActiveAccount: boolean;
};

export type TaskStepRow = {
  id: string;
  content: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  editedAt: string | null;
};

export type TaskDetail = {
  id: string;
  title: string;
  status: TaskStatusValue;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  completedByName: string | null;
  participants: TaskParticipantRow[];
  steps: TaskStepRow[];
};

export type ActiveUserOption = {
  id: string;
  name: string;
  role: string;
};
