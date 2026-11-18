<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useTasksStore } from '../stores/tasks';
import ShareTaskModal from './ShareTaskModal.vue';
import type { TaskFilter, TaskItem } from '../types';

const authStore = useAuthStore();
const tasksStore = useTasksStore();

const newTitle = ref('');
const newDescription = ref('');
const creating = ref(false);
const formError = ref<string | null>(null);

const editingTaskId = ref<string | null>(null);
const editTitle = ref('');
const editDescription = ref('');

const sharingTask = ref<TaskItem | null>(null);

onMounted(() => {
  tasksStore.fetchTasks('all');
  tasksStore.fetchUsers();
});

async function onFilterChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  const value = target.value as TaskFilter;
  await tasksStore.fetchTasks(value);
}

async function handleCreateTask() {
  formError.value = null;
  if (!newTitle.value.trim()) {
    formError.value = 'Please enter a task title.';
    return;
  }

  creating.value = true;
  try {
    await tasksStore.createTask(newTitle.value, newDescription.value);
    newTitle.value = '';
    newDescription.value = '';
  } catch (err: unknown) {
    formError.value =
      err instanceof Error ? err.message : 'Failed to create task';
  } finally {
    creating.value = false;
  }
}

async function toggleCompleted(task: TaskItem) {
  try {
    await tasksStore.updateTask(task.id, { completed: !task.completed });
  } catch (err) {
    console.error('Failed to toggle completion:', err);
  }
}

function startEdit(task: TaskItem) {
  editingTaskId.value = task.id;
  editTitle.value = task.title;
  editDescription.value = task.description;
}

function cancelEdit() {
  editingTaskId.value = null;
  editTitle.value = '';
  editDescription.value = '';
}

async function saveEdit(taskId: string) {
  if (!editTitle.value.trim()) return;
  await tasksStore.updateTask(taskId, {
    title: editTitle.value,
    description: editDescription.value,
  });
  cancelEdit();
}

async function handleDelete(taskId: string) {
  await tasksStore.deleteTask(taskId);
}
</script>

<template>
  <div class="dashboard-container">
    <header class="topbar">
      <div class="brand">
        <div class="logo-badge small">✓</div>
        <div>
          <h1>Shared To-Do List</h1>
          <span class="user-greeting" v-if="authStore.user">
            Signed in as <strong>{{ authStore.user.displayName }}</strong> ({{
              authStore.user.email
            }})
          </span>
        </div>
      </div>

      <button type="button" class="btn-secondary" @click="authStore.logout()">
        Sign Out
      </button>
    </header>

    <main class="main-content">
      <!-- Create New Task Card -->
      <section class="create-task-card">
        <h2>Add a New Task</h2>
        <form @submit.prevent="handleCreateTask" class="create-task-form">
          <div class="form-row">
            <input
              v-model="newTitle"
              type="text"
              placeholder="What needs to be done?"
              required
            />
            <button type="submit" class="btn-primary" :disabled="creating">
              {{ creating ? 'Adding...' : '+ Add Task' }}
            </button>
          </div>
          <input
            v-model="newDescription"
            type="text"
            placeholder="Optional description or notes..."
            class="description-input"
          />
          <div v-if="formError" class="alert-error">{{ formError }}</div>
        </form>
      </section>

      <!-- Tasks Tab & Filter Bar -->
      <section class="tasks-section">
        <div class="tasks-toolbar">
          <div class="tabs-bar">
            <button
              type="button"
              class="tab-pill active"
            >
              Tasks ({{ tasksStore.tasks.length }})
            </button>
          </div>

          <div class="filter-control">
            <label for="taskFilterDropdown">Show:</label>
            <select
              id="taskFilterDropdown"
              :value="tasksStore.activeFilter"
              @change="onFilterChange"
              class="filter-dropdown"
            >
              <option value="all">All Tasks</option>
              <option value="my">My Tasks</option>
              <option value="shared">Shared Tasks</option>
            </select>
          </div>
        </div>

        <div v-if="tasksStore.error" class="alert-error">
          {{ tasksStore.error }}
        </div>

        <div v-if="tasksStore.loading" class="empty-state">
          Loading tasks...
        </div>

        <div
          v-else-if="tasksStore.tasks.length === 0"
          class="empty-state"
        >
          <p v-if="tasksStore.activeFilter === 'all'">
            No tasks yet. Create your first task above or ask a teammate to share one with you!
          </p>
          <p v-else-if="tasksStore.activeFilter === 'my'">
            You haven't created any tasks yet.
          </p>
          <p v-else>
            No tasks have been shared with you yet.
          </p>
        </div>

        <ul v-else class="task-list">
          <li
            v-for="task in tasksStore.tasks"
            :key="task.id"
            :class="['task-card', { completed: task.completed }]"
          >
            <div class="task-main">
              <input
                type="checkbox"
                class="task-checkbox"
                :checked="task.completed"
                @change="toggleCompleted(task)"
              />

              <div v-if="editingTaskId === task.id" class="task-edit-fields">
                <input
                  v-model="editTitle"
                  type="text"
                  class="edit-input"
                  placeholder="Task title"
                />
                <input
                  v-model="editDescription"
                  type="text"
                  class="edit-input"
                  placeholder="Task description"
                />
                <div class="edit-actions">
                  <button
                    type="button"
                    class="btn-primary btn-sm"
                    @click="saveEdit(task.id)"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    class="btn-secondary btn-sm"
                    @click="cancelEdit"
                  >
                    Cancel
                  </button>
                </div>
              </div>

              <div v-else class="task-details">
                <div class="task-title-row">
                  <span class="task-title">{{ task.title }}</span>
                  <span
                    :class="[
                      'ownership-badge',
                      task.isOwner ? 'my-task' : 'shared-task',
                    ]"
                  >
                    {{
                      task.isOwner
                        ? 'My Task'
                        : `Shared by ${task.ownerName}`
                    }}
                  </span>
                </div>

                <p v-if="task.description" class="task-desc">
                  {{ task.description }}
                </p>

                <div class="task-meta">
                  <span v-if="task.sharedWith.length > 0" class="shared-indicator">
                    Shared with:
                    <strong>
                      {{
                        task.sharedWith.map((u) => u.displayName).join(', ')
                      }}
                    </strong>
                  </span>
                </div>
              </div>
            </div>

            <div class="task-actions">
              <button
                type="button"
                class="btn-share"
                @click="sharingTask = task"
              >
                Share
              </button>
              <button
                v-if="editingTaskId !== task.id"
                type="button"
                class="btn-secondary btn-sm"
                @click="startEdit(task)"
              >
                Edit
              </button>
              <button
                v-if="task.isOwner"
                type="button"
                class="btn-danger-outline btn-sm"
                @click="handleDelete(task.id)"
              >
                Delete
              </button>
            </div>
          </li>
        </ul>
      </section>
    </main>

    <!-- Share Task Popup -->
    <ShareTaskModal
      v-if="sharingTask"
      :task="sharingTask"
      @close="sharingTask = null"
    />
  </div>
</template>
