<script setup lang="ts">
console.log('App.vue loaded');
</script>

<template>
  <div class="relative w-screen h-screen overflow-hidden">
    <router-view v-slot="{ Component, route }">
      <transition :name="(route.meta.transition as string)">
        <component class="absolute w-full h-full bg-background-950" :is="Component" :key="route.fullPath" />
      </transition>
    </router-view>
  </div>
</template>
