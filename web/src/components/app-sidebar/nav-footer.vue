<script setup lang="ts">
import { ChevronsUpDownIcon, LogOutIcon } from '@lucide/vue'
import { storeToRefs } from 'pinia'

import { useSidebar } from '@/components/ui/sidebar'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const { displayName, uid, avatarUrl } = storeToRefs(authStore)
const { logout } = useAuth()
const { isMobile, open } = useSidebar()
</script>

<template>
  <UiSidebarMenu>
    <UiSidebarMenuItem>
      <UiDropdownMenu>
        <UiDropdownMenuTrigger as-child>
          <UiSidebarMenuButton
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <UiAvatar class="size-8 rounded-lg">
              <UiAvatarImage v-if="avatarUrl" :src="avatarUrl" alt="头像" />
              <UiAvatarFallback class="rounded-lg">
                {{ displayName ? displayName.charAt(0).toUpperCase() : 'U' }}
              </UiAvatarFallback>
            </UiAvatar>
            <div class="grid flex-1 text-sm leading-tight text-left">
              <span class="font-semibold truncate">{{ displayName }}</span>
              <span class="text-xs truncate">UID: {{ uid }}</span>
            </div>
            <ChevronsUpDownIcon class="ml-auto size-4" />
          </UiSidebarMenuButton>
        </UiDropdownMenuTrigger>
        <UiDropdownMenuContent
          class="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
          :side="(isMobile || open) ? 'bottom' : 'right'"
          align="start"
          :side-offset="4"
        >
          <UiDropdownMenuLabel class="p-0 font-normal">
            <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <UiAvatar class="size-8 rounded-lg">
                <UiAvatarImage v-if="avatarUrl" :src="avatarUrl" alt="头像" />
                <UiAvatarFallback class="rounded-lg">
                  {{ displayName ? displayName.charAt(0).toUpperCase() : 'U' }}
                </UiAvatarFallback>
              </UiAvatar>
              <div class="grid flex-1 text-sm leading-tight text-left">
                <span class="font-semibold truncate">{{ displayName }}</span>
                <span class="text-xs truncate">UID: {{ uid }}</span>
              </div>
            </div>
          </UiDropdownMenuLabel>

          <UiDropdownMenuSeparator />
          <UiDropdownMenuItem @click="logout">
            <LogOutIcon />
            注销
          </UiDropdownMenuItem>
        </UiDropdownMenuContent>
      </UiDropdownMenu>
    </UiSidebarMenuItem>
  </UiSidebarMenu>
</template>
