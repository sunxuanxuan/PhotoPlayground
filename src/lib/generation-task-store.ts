import "server-only";

import type { ModelId } from "@/lib/catalog";
import type { GenerationTask } from "@/lib/generation-task-types";
import { randomUUID } from "node:crypto";
import path from "node:path";

const MAX_VISIBLE_TASKS = 50;
const COMPLETED_TASK_TTL_MS = 24 * 60 * 60 * 1_000;

const globalTaskStore = globalThis as typeof globalThis & {
  __photoPlaygroundGenerationTasks?: Map<string, GenerationTask>;
};

const tasks =
  globalTaskStore.__photoPlaygroundGenerationTasks ??
  new Map<string, GenerationTask>();

globalTaskStore.__photoPlaygroundGenerationTasks = tasks;

function cleanFileName(fileName: string) {
  return path.basename(fileName.replaceAll("\\", "/")).slice(0, 120) || "photo";
}

function updateTask(
  id: string,
  updater: (current: GenerationTask) => GenerationTask,
) {
  const current = tasks.get(id);
  if (!current) return;
  tasks.set(id, updater(current));
}

export function createGenerationTask(input: {
  modelId: ModelId;
  sourceFileNames: string[];
}) {
  const task: GenerationTask = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    modelId: input.modelId,
    sourceFileNames: input.sourceFileNames.map(cleanFileName),
    status: "queued",
    stage: "任务已提交，等待后台处理",
    total: input.sourceFileNames.length,
    completed: 0,
    succeeded: 0,
    failed: 0,
    progress: 0,
  };
  tasks.set(task.id, task);
  return task;
}

export function markGenerationTaskStarted(id: string) {
  updateTask(id, (current) => ({
    ...current,
    status: "processing",
    stage: "模型生成并保存结果中",
    startedAt: new Date().toISOString(),
    progress: Math.max(current.progress, 5),
  }));
}

export function recordGenerationTaskSuccess(
  id: string,
  historyItemId: string,
) {
  updateTask(id, (current) => {
    const completed = Math.min(current.total, current.completed + 1);
    return {
      ...current,
      completed,
      succeeded: current.succeeded + 1,
      progress: Math.round((completed / current.total) * 100),
      latestHistoryItemId: historyItemId,
      stage:
        completed === current.total
          ? "正在完成任务"
          : `已保存 ${completed}/${current.total} 个结果`,
    };
  });
}

export function recordGenerationTaskFailure(id: string, error: string) {
  updateTask(id, (current) => {
    const completed = Math.min(current.total, current.completed + 1);
    return {
      ...current,
      completed,
      failed: current.failed + 1,
      progress: Math.round((completed / current.total) * 100),
      error,
      stage:
        completed === current.total
          ? "正在完成任务"
          : `已处理 ${completed}/${current.total} 个项目`,
    };
  });
}

export function finishGenerationTask(id: string) {
  updateTask(id, (current) => {
    const status =
      current.succeeded === current.total
        ? "completed"
        : current.succeeded > 0
          ? "partial"
          : "failed";
    return {
      ...current,
      status,
      completedAt: new Date().toISOString(),
      progress: 100,
      stage:
        status === "completed"
          ? "全部生成完成"
          : status === "partial"
            ? `部分完成：成功 ${current.succeeded}，失败 ${current.failed}`
            : "任务生成失败",
    };
  });
}

export function listGenerationTasks() {
  const now = Date.now();
  for (const [id, task] of tasks) {
    if (
      task.completedAt &&
      now - Date.parse(task.completedAt) > COMPLETED_TASK_TTL_MS
    ) {
      tasks.delete(id);
    }
  }

  return [...tasks.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_VISIBLE_TASKS);
}
