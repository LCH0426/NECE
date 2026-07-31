<script setup lang="ts" generic="T">
import type { Column } from '@tanstack/vue-table'

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, EyeOffIcon } from '@lucide/vue'
import { computed } from 'vue'

import { cn } from '@/lib/utils'

interface DataTableColumnHeaderProps {
  column: Column<T, any>
  title: string
}

const props = defineProps<DataTableColumnHeaderProps>()

const canSorted = computed(() => props.column.getCanSort())
</script>

<script lang="ts">
export default {
  inheritAttrs: false,
}
</script>

<template>
  <div v-if="canSorted" :class="cn('flex items-center space-x-2', $attrs.class ?? '')">
    <UiDropdownMenu>
      <UiDropdownMenuTrigger as-child>
        <UiButton
          variant="ghost"
          size="sm"
          class="-ml-3 h-8 data-[state=open]:bg-accent"
        >
          <span>{{ title }}</span>

          <ArrowDownIcon v-if="props.column.getIsSorted() === 'desc'" class="ml-2 size-4" />
          <ArrowUpIcon v-else-if="props.column.getIsSorted() === 'asc'" class="ml-2 size-4" />
          <ChevronsUpDownIcon v-else class="ml-2 size-4" />
        </UiButton>
      </UiDropdownMenuTrigger>

      <UiDropdownMenuContent align="start">
        <UiDropdownMenuItem @click="props.column.toggleSorting(false)">
          <ArrowUpIcon class="mr-2 size-4 text-muted-foreground/70" />
          升序
        </UiDropdownMenuItem>
        <UiDropdownMenuItem @click="props.column.toggleSorting(true)">
          <ArrowDownIcon class="mr-2 size-4 text-muted-foreground/70" />
          降序
        </UiDropdownMenuItem>
        <UiDropdownMenuItem @click="props.column.clearSorting()">
          <ChevronsUpDownIcon class="mr-2 size-4 text-muted-foreground/70" />
          取消排序
        </UiDropdownMenuItem>
        <UiDropdownMenuSeparator />
        <UiDropdownMenuItem @click="props.column.toggleVisibility(false)">
          <EyeOffIcon class="mr-2 size-4 text-muted-foreground/70" />
          隐藏
        </UiDropdownMenuItem>
      </UiDropdownMenuContent>
    </UiDropdownMenu>
  </div>

  <div v-else :class="$attrs?.class ?? ''">
    {{ title }}
  </div>
</template>
