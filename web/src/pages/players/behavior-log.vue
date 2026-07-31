<script setup lang="ts">
import type { ColumnDef } from '@tanstack/vue-table'

import { RefreshCwIcon, SearchIcon } from '@lucide/vue'
import { h } from 'vue'
import { toast } from 'vue-sonner'

import type { IBehaviorLogEntry } from '@/services/api/player.api'

import { DataTable, useGenerateVueTable } from '@/components/data-table'
import { BasicPage } from '@/components/global-layout'
import { usePlayerApi } from '@/services/api/player.api'

const { getBehaviorLogs, getBehaviorDates, getBehaviorEvents } = usePlayerApi()

const entries = ref<IBehaviorLogEntry[]>([])
const loading = ref(true)
const currentPage = ref(1)
const pageSize = ref(50)
const total = ref(0)
const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const selectedDate = ref(todayStr)
const playerFilter = ref('')
const eventFilter = ref('all')
const availableDates = ref<string[]>([])
const eventTypes = ref<{ key: string, name: string }[]>([])

async function fetchDates() {
  try {
    const res = await getBehaviorDates()
    if (res.code === 200) {
      availableDates.value = res.data.dates
      if (!availableDates.value.includes(todayStr))
        availableDates.value.unshift(todayStr)
    }
  }
  catch {}
}

async function fetchEventTypes() {
  try {
    const res = await getBehaviorEvents()
    if (res.code === 200)
      eventTypes.value = res.data.events
  }
  catch {}
}

async function fetchLogs() {
  loading.value = true
  try {
    const query: Record<string, any> = {
      page: currentPage.value,
      pageSize: pageSize.value,
    }
    if (selectedDate.value)
      query.date = selectedDate.value
    if (playerFilter.value.trim())
      query.player = playerFilter.value.trim()
    if (eventFilter.value && eventFilter.value !== 'all')
      query.eventType = eventFilter.value

    const res = await getBehaviorLogs(query)
    if (res.code === 200) {
      entries.value = res.data.entries
      total.value = res.data.pagination.total
    }
  }
  catch {
    toast.error('获取行为日志失败')
  }
  finally {
    loading.value = false
  }
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchLogs()
}

function handlePageSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1
  fetchLogs()
}

function handleSearch() {
  currentPage.value = 1
  fetchLogs()
}

function handleRefresh() {
  fetchLogs()
  toast.success('已刷新行为日志')
}

const dimensionMap: Record<string, string> = {
  0: '主世界',
  1: '下界',
  2: '末地',
}

const columns: ColumnDef<IBehaviorLogEntry>[] = [
  {
    accessorKey: 'time',
    header: () => h('div', { class: 'text-sm font-medium' }, '时间'),
    cell: ({ row }) => h('div', { class: 'text-xs font-mono whitespace-nowrap' }, row.original.time),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'source',
    header: () => h('div', { class: 'text-sm font-medium' }, '玩家'),
    cell: ({ row }) => h('div', { class: 'text-sm font-medium' }, row.original.source),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'event',
    header: () => h('div', { class: 'text-sm font-medium' }, '事件'),
    cell: ({ row }) => h('span', {
      class: 'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold',
    }, row.original.event),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'target',
    header: () => h('div', { class: 'text-sm font-medium' }, '目标'),
    cell: ({ row }) => h('div', { class: 'text-sm max-w-[150px] truncate' }, row.original.target || '-'),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'dim',
    header: () => h('div', { class: 'text-sm font-medium' }, '维度'),
    cell: ({ row }) => h('div', {}, dimensionMap[row.original.dim] || row.original.dim),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'position',
    header: () => h('div', { class: 'text-sm font-medium' }, '坐标'),
    cell: ({ row }) => h('div', { class: 'font-mono text-xs' }, `${row.original.x}, ${row.original.y}, ${row.original.z}`),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'extra',
    header: () => h('div', { class: 'text-sm font-medium' }, '附加'),
    cell: ({ row }) => h('div', { class: 'text-xs max-w-[150px] truncate text-muted-foreground' }, row.original.extra || '-'),
    enableSorting: false,
    enableResizing: true,
  },
]

const serverPagination = computed(() => ({
  page: currentPage.value,
  pageSize: pageSize.value,
  total: total.value,
  onPageChange: handlePageChange,
  onPageSizeChange: handlePageSizeChange,
}))

const tableProps = reactive({
  columns,
  data: entries,
  serverPagination,
})

const table = useGenerateVueTable<IBehaviorLogEntry>(tableProps)

onMounted(async () => {
  await Promise.all([fetchDates(), fetchEventTypes()])
  fetchLogs()
})
</script>

<template>
  <BasicPage title="行为日志" description="查看玩家行为日志" sticky>
    <template #actions>
      <div class="flex items-center gap-2">
        <UiButton variant="outline" size="sm" :disabled="loading" @click="handleRefresh">
          <RefreshCwIcon class="size-4 mr-1" />
          刷新
        </UiButton>
      </div>
    </template>

    <div class="space-y-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted-foreground">日期:</span>
          <UiSelect :model-value="selectedDate" @update:model-value="(v: any) => { selectedDate = String(v); handleSearch() }">
            <UiSelectTrigger class="w-[160px]">
              <UiSelectValue placeholder="选择日期" />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem v-for="d in availableDates" :key="d" :value="d">
                {{ d }}
              </UiSelectItem>
            </UiSelectContent>
          </UiSelect>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted-foreground">事件:</span>
          <UiSelect :model-value="eventFilter" @update:model-value="(v: any) => { eventFilter = String(v); handleSearch() }">
            <UiSelectTrigger class="w-[160px]">
              <UiSelectValue placeholder="全部事件" />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem value="all">
                全部
              </UiSelectItem>
              <UiSelectItem v-for="e in eventTypes" :key="e.key" :value="e.name">
                {{ e.name }}
              </UiSelectItem>
            </UiSelectContent>
          </UiSelect>
        </div>
        <div class="flex items-center gap-2">
          <UiInput
            v-model="playerFilter"
            placeholder="搜索玩家名"
            class="w-[180px]"
            @keydown.enter="handleSearch"
          />
          <UiButton variant="outline" size="icon" @click="handleSearch">
            <SearchIcon class="size-4" />
          </UiButton>
        </div>
        <span class="text-sm text-muted-foreground">
          共 {{ total }} 条记录
        </span>
      </div>

      <div class="overflow-x-auto">
        <DataTable :loading :data="entries" :columns :table :server-pagination="serverPagination" />
      </div>
    </div>
  </BasicPage>
</template>
