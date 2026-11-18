import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAuthStore } from './auth';
import type { TaskItem, TaskFilter, SharedUserSummary } from '../types';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || '/api';

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref<TaskItem[]>([]);
  const availableUsers = ref<SharedUserSummary[]>([]);
  const activeFilter = ref<TaskFilter>('all');
  const loading = ref<boolean>(false);
  const error = ref<string | null>(null);

  function getAuthHeaders(): HeadersInit {
    const authStore = useAuthStore();
    return {
      'Content-Type': 'application/json',
      ...(authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {}),
    };
  }

  async function fetchTasks(filter?: TaskFilter): Promise<void> {
    if (filter) {
      activeFilter.value = filter;
    }
    loading.value = true;
    error.value = null;
    try {
      const response = await fetch(
        `${API_BASE_URL}/tasks?filter=${encodeURIComponent(activeFilter.value)}`,
        {
          headers: getAuthHeaders(),
        }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load tasks');
      }
      const data = (await response.json()) as { tasks: TaskItem[] };
      tasks.value = data.tasks;
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to load tasks';
    } finally {
      loading.value = false;
    }
  }

  async function fetchUsers(): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/users`, {
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        const data = (await response.json()) as { users: SharedUserSummary[] };
        availableUsers.value = data.users;
      }
    } catch (err) {
      console.warn('Failed to fetch users list:', err);
    }
  }

  async function createTask(title: string, description: string): Promise<void> {
    error.value = null;
    const response = await fetch(`${API_BASE_URL}/tasks`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ title, description }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to create task');
    }

    await fetchTasks();
  }

  async function updateTask(
    taskId: string,
    updates: { title?: string; description?: string; completed?: boolean }
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to update task');
    }

    const data = (await response.json()) as { task: TaskItem };
    const idx = tasks.value.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      tasks.value[idx] = data.task;
    } else {
      await fetchTasks();
    }
  }

  async function deleteTask(taskId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete task');
    }

    tasks.value = tasks.value.filter((t) => t.id !== taskId);
  }

  async function shareTask(
    taskId: string,
    emailOrUserId: string
  ): Promise<SharedUserSummary> {
    const response = await fetch(`${API_BASE_URL}/tasks/${taskId}/share`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ emailOrUserId }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Failed to share task');
    }

    await fetchTasks();
    return data.sharedWithUser as SharedUserSummary;
  }

  async function unshareTask(
    taskId: string,
    targetUserId: string
  ): Promise<void> {
    const response = await fetch(
      `${API_BASE_URL}/tasks/${taskId}/share/${targetUserId}`,
      {
        method: 'DELETE',
        headers: getAuthHeaders(),
      }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to remove shared user');
    }

    await fetchTasks();
  }

  return {
    tasks,
    availableUsers,
    activeFilter,
    loading,
    error,
    fetchTasks,
    fetchUsers,
    createTask,
    updateTask,
    deleteTask,
    shareTask,
    unshareTask,
  };
});
