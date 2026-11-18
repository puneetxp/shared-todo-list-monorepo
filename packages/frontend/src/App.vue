<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuthStore } from './stores/auth';
import AuthView from './components/AuthView.vue';
import TaskBoard from './components/TaskBoard.vue';

const authStore = useAuthStore();

onMounted(() => {
  authStore.initializeAuth();
});
</script>

<template>
  <div class="app-root">
    <div v-if="authStore.loading" class="loading-screen">
      <div class="spinner"></div>
      <p>Initializing Shared To-Do List...</p>
    </div>
    <TaskBoard v-else-if="authStore.isAuthenticated" />
    <AuthView v-else />
  </div>
</template>
