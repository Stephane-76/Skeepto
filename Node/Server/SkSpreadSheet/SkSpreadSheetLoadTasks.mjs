import { randomUUID } from 'crypto';

const TASK_TTL_MS = 30 * 60 * 1000;
const loadTasks = new Map();

function pruneExpiredTasks() {
  const now = Date.now();
  for (const [taskId, task] of loadTasks.entries()) {
    const refTime = task.finishedAt || task.startedAt;
    if (now - refTime > TASK_TTL_MS) {
      loadTasks.delete(taskId);
    }
  }
}

export function createLoadTask(path) {
  pruneExpiredTasks();
  const taskId = randomUUID();
  const task = {
    taskId,
    path,
    status: 'loading',
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  loadTasks.set(taskId, task);
  return task;
}

export function setLoadTaskReady(taskId) {
  const task = loadTasks.get(taskId);
  if (!task) return null;
  task.status = 'ready';
  task.finishedAt = Date.now();
  task.error = null;
  return task;
}

export function setLoadTaskError(taskId, errorMessage) {
  const task = loadTasks.get(taskId);
  if (!task) return null;
  task.status = 'error';
  task.finishedAt = Date.now();
  task.error = errorMessage || 'Unknown error';
  return task;
}

export function getLoadTask(taskId) {
  pruneExpiredTasks();
  const task = loadTasks.get(taskId);
  if (!task) return null;
  return {
    taskId: task.taskId,
    path: task.path,
    status: task.status,
    error: task.error,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  };
}
