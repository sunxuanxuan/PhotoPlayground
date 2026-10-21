import type { ModelId } from "@/lib/catalog";

export type GenerationTaskStatus =
  | "queued"
  | "processing"
  | "completed"
  | "partial"
  | "failed";

export type GenerationTask = {
  id: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  modelId: ModelId;
  sourceFileNames: string[];
  status: GenerationTaskStatus;
  stage: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  progress: number;
  latestHistoryItemId?: string;
  error?: string;
};

export type GenerationTaskListResponse = {
  tasks: GenerationTask[];
};

export function isActiveGenerationTask(task: GenerationTask) {
  return task.status === "queued" || task.status === "processing";
}

export function isFinishedGenerationTask(task: GenerationTask) {
  return !isActiveGenerationTask(task);
}
