<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';

const authStore = useAuthStore();

const isRegisterMode = ref(false);
const idOrEmail = ref('');
const password = ref('');
const displayName = ref('');
const localError = ref<string | null>(null);
const submitting = ref(false);

function toggleMode() {
  isRegisterMode.value = !isRegisterMode.value;
  localError.value = null;
  authStore.error = null;
}

async function handleSubmit() {
  localError.value = null;
  if (!idOrEmail.value.trim() || !password.value) {
    localError.value = 'Please enter both your Email / User ID and password.';
    return;
  }

  submitting.value = true;
  try {
    if (isRegisterMode.value) {
      await authStore.register(
        idOrEmail.value,
        password.value,
        displayName.value
      );
    } else {
      await authStore.login(idOrEmail.value, password.value);
    }
  } catch (err: unknown) {
    localError.value =
      err instanceof Error ? err.message : 'Authentication failed';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="auth-wrapper">
    <div class="auth-card">
      <div class="auth-header">
        <div class="logo-badge">✓</div>
        <h1>Shared To-Do List</h1>
        <p class="subtitle">
          {{
            isRegisterMode
              ? 'Create a new account to manage and share tasks'
              : 'Sign in with your ID / Email and password'
          }}
        </p>
      </div>

      <div class="auth-mode-tabs">
        <button
          type="button"
          :class="['mode-tab', { active: !isRegisterMode }]"
          @click="isRegisterMode = false"
        >
          Login
        </button>
        <button
          type="button"
          :class="['mode-tab', { active: isRegisterMode }]"
          @click="isRegisterMode = true"
        >
          Create Account
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="auth-form">
        <div v-if="isRegisterMode" class="form-group">
          <label for="displayName">Display Name</label>
          <input
            id="displayName"
            v-model="displayName"
            type="text"
            placeholder="e.g. Alice Johnson"
            autocomplete="name"
          />
        </div>

        <div class="form-group">
          <label for="idOrEmail">User ID or Email</label>
          <input
            id="idOrEmail"
            v-model="idOrEmail"
            type="text"
            placeholder="alice@example.com or alice"
            autocomplete="username"
            required
          />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            placeholder="Minimum 6 characters"
            autocomplete="current-password"
            required
          />
        </div>

        <div v-if="localError || authStore.error" class="alert-error">
          {{ localError || authStore.error }}
        </div>

        <button type="submit" class="btn-primary full-width" :disabled="submitting">
          {{
            submitting
              ? 'Please wait...'
              : isRegisterMode
                ? 'Create Account & Sign In'
                : 'Sign In'
          }}
        </button>
      </form>

      <div class="auth-footer">
        <span>
          {{
            isRegisterMode
              ? 'Already have an account?'
              : "Don't have an account yet?"
          }}
        </span>
        <button type="button" class="link-btn" @click="toggleMode">
          {{ isRegisterMode ? 'Sign in here' : 'Create a new user' }}
        </button>
      </div>
    </div>
  </div>
</template>
