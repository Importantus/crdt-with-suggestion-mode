<script setup lang="ts">
import router from '@/router';
import { users, useUserStore } from '@/stores/user';

const userStore = useUserStore()

function handleUserSelection(userId: string) {
  userStore.setActiveUser(userId);
  router.push('/')
}
</script>

<template>
  <div class="h-screen w-screen overflow-hidden flex items-center justify-center bg-gray-100">
    <div class="flex flex-col items-center justify-center w-lg gap-2">
      <div v-for="user in users" :key="user.id" :style="{ borderColor: user.color }"
        class="flex justify-center rounded-lg bg-gray-200 hover:bg-gray-300 transition-all duration-200 w-full p-4 cursor-pointer border-2"
        @click="handleUserSelection(user.id)">
        <p :style="{ color: user.color }">{{ user.name }}</p>
      </div>
    </div>
  </div>
</template>
