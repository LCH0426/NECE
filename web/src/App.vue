<script setup lang="ts">
import Loading from '@/components/loading.vue'
import { Toaster } from '@/components/ui/sonner'
import { useSystemTheme } from '@/composables/use-system-theme'

useSystemTheme()
</script>

<template>
  <Toaster position="bottom-right" />

  <Suspense>
    <router-view v-slot="{ Component, route }">
      <component :is="Component" :key="route.fullPath" />
    </router-view>

    <template #fallback>
      <Loading />
    </template>
  </Suspense>
</template>
