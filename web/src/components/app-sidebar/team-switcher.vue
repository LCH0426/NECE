<script lang="ts" setup>
import type { Team } from './types'

const { teams } = defineProps<{
  teams: Team[]
}>()

const activeTeam = ref<Team>(teams[0])
const dialogOpen = ref(false)
const buildDate = __APP_BUILD_DATE__
</script>

<template>
  <UiSidebarMenu>
    <UiSidebarMenuItem>
      <UiSidebarMenuButton
        size="lg"
        class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        @click="dialogOpen = true"
      >
        <div
          class="flex items-center justify-center rounded-lg aspect-square size-8 overflow-hidden" :class="[
            typeof activeTeam.logo === 'string' ? '' : 'bg-sidebar-primary text-sidebar-primary-foreground',
          ]"
        >
          <img v-if="typeof activeTeam.logo === 'string'" :src="activeTeam.logo" :alt="activeTeam.name" class="size-8 object-cover">
          <component :is="activeTeam.logo" v-else class="size-4" />
        </div>
        <div class="grid flex-1 text-sm leading-tight text-left">
          <span class="font-semibold truncate">{{ activeTeam.name }}</span>
          <span class="text-xs truncate">{{ activeTeam.plan }}</span>
        </div>
      </UiSidebarMenuButton>
    </UiSidebarMenuItem>
  </UiSidebarMenu>

  <UiDialog v-model:open="dialogOpen">
    <UiDialogContent class="sm:max-w-[320px]">
      <UiDialogHeader class="items-center">
        <div class="size-16 rounded-lg overflow-hidden">
          <img v-if="typeof activeTeam.logo === 'string'" :src="activeTeam.logo" :alt="activeTeam.name" class="size-16 object-cover">
          <component :is="activeTeam.logo" v-else class="size-8" />
        </div>
        <UiDialogTitle class="text-lg">
          {{ activeTeam.name }}
        </UiDialogTitle>
        <UiDialogDescription>
          构建日期：{{ buildDate }}
        </UiDialogDescription>
      </UiDialogHeader>
      <div class="flex justify-center pt-2">
        <UiButton variant="outline" size="sm" as-child>
          <a href="https://github.com/LCH0426/NECE" target="_blank" rel="noopener noreferrer">
            <svg class="size-4 mr-2" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
            GitHub
          </a>
        </UiButton>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
