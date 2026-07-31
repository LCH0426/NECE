<script setup lang="ts">
import { MoonIcon, SunIcon, SunMoonIcon } from '@lucide/vue'
import { useColorMode } from '@vueuse/core'

import CommandItemHasIcon from './command-item-has-icon.vue'

defineEmits<{
  (e: 'click'): void
}>()

const mode = useColorMode()
</script>

<template>
  <UiCommandGroup heading="主题">
    <UiCommandItem value="light" @click="mode = 'light', $emit('click')">
      <CommandItemHasIcon name="浅色模式" :icon="SunIcon" />
    </UiCommandItem>
    <UiCommandItem value="dark" @click="mode = 'dark', $emit('click')">
      <CommandItemHasIcon name="深色模式" :icon="MoonIcon" />
    </UiCommandItem>
    <UiCommandItem value="system" @click="mode = 'auto', $emit('click')">
      <CommandItemHasIcon name="跟随系统" :icon="SunMoonIcon" />
    </UiCommandItem>
  </UiCommandGroup>
</template>
