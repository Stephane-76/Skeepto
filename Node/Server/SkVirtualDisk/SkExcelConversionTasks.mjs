import { randomUUID } from 'crypto';

/** SkExcel can run 30+ minutes on large workbooks. */
const TASK_TTL_MS = 3 * 60 * 60 * 1000;
const conversionTasks = new Map();

function pruneExpiredTasks() {
  const now = Date.now();
  for (const [taskId, task] of conversionTasks.entries()) {
    const refTime = task.finishedAt || task.startedAt;
    if (now - refTime > TASK_TTL_MS) {
      conversionTasks.delete(taskId);
    }
  }
}

export function createExcelConversionTask(sourcePath, fileName) {
  pruneExpiredTasks();
  const taskId = randomUUID();
  const task = {
    taskId,
    sourcePath,
    fileName: fileName || '',
    status: 'converting',
    error: null,
    result: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  conversionTasks.set(taskId, task);
  return task;
}

export function setExcelConversionReady(taskId, result) {
  const task = conversionTasks.get(taskId);
  if (!task) return null;
  task.status = 'ready';
  task.finishedAt = Date.now();
  task.error = null;
  task.result = result || null;
  return task;
}

export function setExcelConversionError(taskId, errorMessage, details = null) {
  const task = conversionTasks.get(taskId);
  if (!task) return null;
  task.status = 'error';
  task.finishedAt = Date.now();
  task.error = errorMessage || 'Conversion failed';
  task.result = details;
  return task;
}

export function getExcelConversionTask(taskId) {
  pruneExpiredTasks();
  const task = conversionTasks.get(taskId);
  if (!task) return null;
  return {
    taskId: task.taskId,
    sourcePath: task.sourcePath,
    fileName: task.fileName,
    status: task.status,
    error: task.error,
    result: task.result,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  };
}
