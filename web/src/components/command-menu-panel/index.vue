<script setup lang="ts">
import { MenuIcon, SearchIcon } from '@lucide/vue'
import { useEventListener } from '@vueuse/core'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

import CommandChangeTheme from './command-change-theme.vue'
import CommandToPage from './command-to-page.vue'

const open = ref(false)

useEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    handleOpenChange()
  }
})

function handleOpenChange() {
  open.value = !open.value
}

const firstKey = computed(() => navigator?.userAgent.includes('Mac OS') ? '⌘' : 'Ctrl')
</script>

<template>
  <div>
    <div
      class="text-sm items-center justify-between text-muted-foreground border border-border bg-muted/5 px-4 py-2 rounded-md md:min-w-[220px] cursor-pointer hidden md:flex"
      @click="handleOpenChange"
    >
      <div class="flex items-center gap-2">
        <SearchIcon class="size-4" />
        <span class="text-xs font-semibold text-muted-foreground">搜索关键词</span>
      </div>
      <UiKbd>{{ firstKey }} + k</UiKbd>
    </div>

    <UiButton variant="outline" size="icon" class="md:hidden" @click="handleOpenChange">
      <SearchIcon />
    </UiButton>

    <UiCommandDialog v-model:open="open">
      <UiCommandInput placeholder="输入命令或搜索..." />
      <UiCommandList>
        <UiCommandEmpty>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MenuIcon />
              </EmptyMedia>
              <EmptyTitle>未找到菜单</EmptyTitle>
              <EmptyDescription>
                请尝试搜索其他关键词
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </UiCommandEmpty>

        <CommandToPage @click="handleOpenChange" />
        <UiCommandSeparator />
        <CommandChangeTheme @click="handleOpenChange" />
      </UiCommandList>
    </UiCommandDialog>
  </div>
</template>
