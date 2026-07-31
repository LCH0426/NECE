<script lang="ts" setup>
import { useSidebar } from '@/composables/use-sidebar'

import { teams } from './data/sidebar-data'
import NavFooter from './nav-footer.vue'
import NavTeam from './nav-team.vue'
import TeamSwitcher from './team-switcher.vue'

const { navData } = useSidebar()
const navMain = computed(() => navData.value ?? [])
</script>

<template>
  <UiSidebar collapsible="icon" class="z-50">
    <UiSidebarHeader>
      <TeamSwitcher :teams="teams" />
    </UiSidebarHeader>

    <UiSidebarContent>
      <NavTeam :nav-main="navMain" />
    </UiSidebarContent>

    <UiSidebarFooter>
      <NavFooter />
    </UiSidebarFooter>

    <UiSidebarRail />
  </UiSidebar>
</template>
