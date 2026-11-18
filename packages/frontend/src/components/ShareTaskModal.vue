<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useTasksStore } from '../stores/tasks';
import type { TaskItem } from '../types';

const props = defineProps<{
  task: TaskItem;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const tasksStore = useTasksStore();
const emailOrUserId = ref('');
const selectedUserEmail = ref('');
const submitting = ref(false);
const errorMsg = ref<string | null>(null);
const successMsg = ref<string | null>(null);

const currentTask = computed(
  () => tasksStore.tasks.find((t) => t.id === props.task.id) || props.task
);

const unsharedRegisteredUsers = computed(() => {
  const sharedIds = new Set(currentTask.value.sharedWith.map((u) => u.id));
  return tasksStore.availableUsers.filter(
    (u) => !sharedIds.has(u.id) && u.id !== currentTask.value.ownerId
  );
});

onMounted(() => {
  tasksStore.fetchUsers();
});

function selectQuickUser(email: string) {
  emailOrUserId.value = email;
  selectedUserEmail.value = email;
}

async function handleShare() {
  const target = emailOrUserId.value.trim() || selectedUserEmail.value.trim();
  if (!target) {
    errorMsg.value = 'Please enter or select a user email / ID to share with.';
    return;
  }

  // Normalize bare username ID to match auth convention if needed
  const normalizedTarget = target.includes('@') || target.length === 36
    ? target
    : `${target.toLowerCase()}@sharedtodo.app`;

  submitting.value = true;
  errorMsg.value = null;
  successMsg.value = null;

  try {
    const sharedUser = await tasksStore.shareTask(
      currentTask.value.id,
      normalizedTarget
    );
    successMsg.value = `Task shared with ${sharedUser.displayName} (${sharedUser.email})`;
    emailOrUserId.value = '';
    selectedUserEmail.value = '';
  } catch (err: unknown) {
    // Retry with raw target in case it was a direct match
    if (normalizedTarget !== target) {
      try {
        const sharedUser = await tasksStore.shareTask(
          currentTask.value.id,
          target
        );
        successMsg.value = `Task shared with ${sharedUser.displayName} (${sharedUser.email})`;
        emailOrUserId.value = '';
        selectedUserEmail.value = '';
        return;
      } catch {
        // Fall through to original error
      }
    }
    errorMsg.value =
      err instanceof Error ? err.message : 'Could not share task';
  } finally {
    submitting.value = false;
  }
}

async function handleRemoveShare(userId: string) {
  errorMsg.value = null;
  successMsg.value = null;
  try {
    await tasksStore.unshareTask(currentTask.value.id, userId);
  } catch (err: unknown) {
    errorMsg.value =
      err instanceof Error ? err.message : 'Failed to remove shared access';
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div>
          <h2>Share Task</h2>
          <p class="modal-subtitle">
            "{{ currentTask.title }}"
          </p>
        </div>
        <button
          type="button"
          class="btn-icon"
          aria-label="Close modal"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <form @submit.prevent="handleShare" class="share-form">
        <div class="form-group">
          <label for="shareTarget">Share with User (Email or User ID)</label>
          <div class="input-row">
            <input
              id="shareTarget"
              v-model="emailOrUserId"
              type="text"
              placeholder="Enter colleague's email or ID..."
            />
            <button type="submit" class="btn-primary" :disabled="submitting">
              {{ submitting ? 'Sharing...' : 'Share' }}
            </button>
          </div>
        </div>

        <div v-if="unsharedRegisteredUsers.length > 0" class="quick-users">
          <span class="quick-label">Registered users:</span>
          <div class="user-chips">
            <button
              v-for="u in unsharedRegisteredUsers"
              :key="u.id"
              type="button"
              class="user-chip"
              @click="selectQuickUser(u.email)"
            >
              + {{ u.displayName }} ({{ u.email }})
            </button>
          </div>
        </div>
      </form>

      <div v-if="errorMsg" class="alert-error">{{ errorMsg }}</div>
      <div v-if="successMsg" class="alert-success">{{ successMsg }}</div>

      <div class="shared-list-section">
        <h3>People with access</h3>
        <ul class="shared-users-list">
          <li class="shared-user-row">
            <div class="user-info">
              <span class="avatar">{{
                currentTask.ownerName.charAt(0).toUpperCase()
              }}</span>
              <div>
                <div class="user-name">{{ currentTask.ownerName }}</div>
                <div class="user-email">{{ currentTask.ownerEmail }}</div>
              </div>
            </div>
            <span class="role-badge owner">Owner</span>
          </li>

          <li
            v-for="sharedUser in currentTask.sharedWith"
            :key="sharedUser.id"
            class="shared-user-row"
          >
            <div class="user-info">
              <span class="avatar secondary">{{
                sharedUser.displayName.charAt(0).toUpperCase()
              }}</span>
              <div>
                <div class="user-name">{{ sharedUser.displayName }}</div>
                <div class="user-email">{{ sharedUser.email }}</div>
              </div>
            </div>
            <button
              type="button"
              class="btn-danger-outline btn-sm"
              @click="handleRemoveShare(sharedUser.id)"
            >
              Remove
            </button>
          </li>
        </ul>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn-secondary" @click="emit('close')">
          Done
        </button>
      </div>
    </div>
  </div>
</template>
