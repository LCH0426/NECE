<script setup lang="ts">
import type { ColumnDef } from '@tanstack/vue-table'

import { RefreshCwIcon } from '@lucide/vue'
import { h } from 'vue'
import { toast } from 'vue-sonner'

import type { IAdminLogEntry } from '@/services/api/player.api'

import { DataTable, useGenerateVueTable } from '@/components/data-table'
import { BasicPage } from '@/components/global-layout'
import { usePlayerApi } from '@/services/api/player.api'

const { getAdminLogs, getAdminLogDates } = usePlayerApi()

const entries = ref<IAdminLogEntry[]>([])
const loading = ref(true)
const currentPage = ref(1)
const pageSize = ref(50)
const total = ref(0)
const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const selectedDate = ref(todayStr)
const availableDates = ref<string[]>([])

async function fetchDates() {
  try {
    const res = await getAdminLogDates()
    if (res.code === 200) {
      availableDates.value = res.data.dates
      if (!availableDates.value.includes(todayStr))
        availableDates.value.unshift(todayStr)
    }
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

    const res = await getAdminLogs(query)
    if (res.code === 200) {
      entries.value = res.data.entries
      total.value = res.data.pagination.total
    }
  }
  catch {
    toast.error('获取操作日志失败')
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
  toast.success('已刷新操作日志')
}

const actionMap: Record<string, string> = {
  send_mail: '发送邮件',
  add_whitelist: '添加白名单',
  remove_whitelist: '移除白名单',
  kick_player: '踢出玩家',
  ban_player: '封禁玩家',
  unban_player: '解封玩家',
  send_chat: '发送聊天',
  update_player: '更新玩家',
  delete_mail: '删除邮件',
  execute_command: '执行命令',
}

const columns: ColumnDef<IAdminLogEntry>[] = [
  {
    accessorKey: 'time',
    header: () => h('div', { class: 'text-sm font-medium' }, '时间'),
    cell: ({ row }) => h('div', { class: 'text-xs font-mono whitespace-nowrap' }, row.original.time),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'admin',
    header: () => h('div', { class: 'text-sm font-medium' }, '管理员'),
    cell: ({ row }) => h('div', { class: 'text-sm font-medium' }, row.original.admin),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'action',
    header: () => h('div', { class: 'text-sm font-medium' }, '操作'),
    cell: ({ row }) => h('span', {
      class: 'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold',
    }, actionMap[row.original.action] || row.original.action),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'target',
    header: () => h('div', { class: 'text-sm font-medium' }, '目标'),
    cell: ({ row }) => h('div', { class: 'text-sm max-w-[200px] truncate' }, row.original.target || '-'),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'detail',
    header: () => h('div', { class: 'text-sm font-medium' }, '详情'),
    cell: ({ row }) => h('div', { class: 'text-xs max-w-[300px] truncate text-muted-foreground' }, row.original.detail || '-'),
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

const table = useGenerateVueTable<IAdminLogEntry>(tableProps)

onMounted(async () => {
  await fetchDates()
  fetchLogs()
})
</script>

<template>
  <BasicPage title="操作日志" description="查看管理员网页操作日志" sticky>
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
