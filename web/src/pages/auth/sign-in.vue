<script setup lang="ts">
import bannerImg from '@/assets/img/banner.webp'

import LoginForm from './components/login-form.vue'
</script>

<template>
  <div class="relative flex items-center justify-center min-h-screen min-w-screen overflow-hidden">
    <img
      :src="bannerImg"
      alt="Background"
      class="absolute inset-0 w-full h-full object-cover"
    >
    <div class="absolute inset-0 bg-black/20" />
    <main class="relative z-10">
      <LoginForm />
    </main>
  </div>
</template>

<route lang="yaml">
meta:
  layout: false
</route>
