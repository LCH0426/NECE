<script setup lang="ts">
import type { ColumnDef } from '@tanstack/vue-table'

import { SearchIcon, SendIcon, Trash2Icon } from '@lucide/vue'
import { h } from 'vue'
import { toast } from 'vue-sonner'

import type { IMailDetail, IMailItem, IPlayer } from '@/services/api/player.api'
import type { IItemSearchResult } from '@/services/api/recycle.api'

import { DataTable, useGenerateVueTable } from '@/components/data-table'
import { BasicPage } from '@/components/global-layout'
import ItemTexture from '@/components/item-texture.vue'
import { usePlayerApi } from '@/services/api/player.api'
import { useRecycleApi } from '@/services/api/recycle.api'

const { getMails, getMailDetail, sendMail, deleteMail, getPlayers } = usePlayerApi()
const { searchItems } = useRecycleApi()

const mails = ref<IMailItem[]>([])
const loading = ref(true)
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const searchQuery = ref('')
const typeFilter = ref<string>('all')

// 批量选择 - 从 table 实例获取选中行（不能通过 reactive 传递 ref，会被自动解包）
const selectedMailIds = computed(() => {
  if (!table)
    return []
  return table.getFilteredSelectedRowModel().rows.map(row => row.original.id)
})

const typeOptions = [
  { label: '全部', value: 'all' },
  { label: '个人邮件', value: 'personal' },
  { label: '全局邮件', value: 'global' },
  { label: '定时邮件', value: 'scheduled' },
  { label: '含物品', value: 'hasItems' },
  { label: '含星币', value: 'hasStarQian' },
]

async function fetchMails() {
  loading.value = true
  try {
    const query: Record<string, any> = {
      page: currentPage.value,
      pageSize: pageSize.value,
    }
    if (typeFilter.value !== 'all')
      query.type = typeFilter.value
    if (searchQuery.value.trim())
      query.search = searchQuery.value.trim()

    const res = await getMails(query as any)
    if (res.code === 200) {
      mails.value = res.data.mails
      total.value = res.data.pagination.total
    }
  }
  catch {
    toast.error('获取邮件列表失败')
  }
  finally {
    loading.value = false
  }
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchMails()
}

function handlePageSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1
  fetchMails()
}

function handleSearch() {
  currentPage.value = 1
  fetchMails()
  toast.success('已刷新邮件列表')
}

function handleTypeChange(val: any) {
  typeFilter.value = String(val)
  currentPage.value = 1
  fetchMails()
}

function handleRefresh() {
  fetchMails()
  toast.success('已刷新邮件列表')
}

function formatTime(time: string): string {
  if (!time)
    return '-'
  const parts = time.split('.')
  if (parts.length >= 6) {
    return `${parts[0]}-${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}:${parts[5]}`
  }
  return new Date(time).toLocaleString('zh-CN')
}

const detailDialogOpen = ref(false)
const sendDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const batchDeleteDialogOpen = ref(false)
const selectedMail = ref<IMailItem | null>(null)
const mailDetail = ref<IMailDetail | null>(null)
const detailLoading = ref(false)
const actionLoading = ref(false)
const actionError = ref('')
const actionResult = ref('')

const sendForm = reactive({
  content: '',
  starQian: 0,
  scheduledTime: '',
  isGlobal: false,
  items: [] as { type: string, id?: string, snbt?: string, count: number, displayName?: string }[],
})

const isGlobalMail = computed({
  get: () => sendForm.isGlobal === true,
  set: (val: boolean | string) => { sendForm.isGlobal = val === true },
})

watch(() => sendForm.isGlobal, (val) => {
  if (val) {
    selectedRecipients.value = []
    playerSearchQuery.value = ''
    playerSearchResults.value = []
  }
})

const newItemCount = ref(1)
const itemSearchQuery = ref('')
const itemSearchResults = ref<IItemSearchResult[]>([])
const itemSearchLoading = ref(false)
const snbtInput = ref('')
let itemSearchTimer: ReturnType<typeof setTimeout> | null = null

function handleItemSearch(val: string | number) {
  const v = String(val)
  itemSearchQuery.value = v
  if (itemSearchTimer) {
    clearTimeout(itemSearchTimer)
    itemSearchTimer = null
  }
  if (!v.trim()) {
    itemSearchResults.value = []
    return
  }
  const keyword = v.trim()
  itemSearchTimer = setTimeout(async () => {
    itemSearchLoading.value = true
    try {
      const res = await searchItems(keyword)
      if (res.code === 200)
        itemSearchResults.value = res.data
      else itemSearchResults.value = []
    }
    catch {
      itemSearchResults.value = []
    }
    finally {
      itemSearchLoading.value = false
    }
  }, 200)
}

function selectItem(item: IItemSearchResult) {
  if (sendForm.items.length >= 10) {
    toast.error('附件物品不能超过10个')
    return
  }
  sendForm.items.push({ type: 'item', id: item.id, count: newItemCount.value || 1, displayName: `${item.name} (${item.id})` })
  itemSearchQuery.value = ''
  itemSearchResults.value = []
  newItemCount.value = 1
}

function addSnbtItem() {
  if (!snbtInput.value.trim()) {
    toast.error('请输入SNBT数据')
    return
  }
  if (sendForm.items.length >= 10) {
    toast.error('附件物品不能超过10个')
    return
  }
  sendForm.items.push({ type: 'snbt', snbt: snbtInput.value.trim(), count: 1, displayName: 'SNBT物品' })
  snbtInput.value = ''
}

const playerSearchQuery = ref('')
const playerSearchResults = ref<IPlayer[]>([])
const playerSearchLoading = ref(false)
const selectedRecipients = ref<IPlayer[]>([])
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

async function searchPlayers(query: string) {
  if (!query.trim()) {
    playerSearchResults.value = []
    return
  }
  playerSearchLoading.value = true
  try {
    const res = await getPlayers({ search: query.trim(), page: 1, pageSize: 10 })
    if (res.code === 200)
      playerSearchResults.value = res.data.players
  }
  catch {
    playerSearchResults.value = []
  }
  finally {
    playerSearchLoading.value = false
  }
}

function handlePlayerSearchInput(val: string | number) {
  const v = String(val)
  playerSearchQuery.value = v
  if (searchDebounceTimer)
    clearTimeout(searchDebounceTimer)
  if (!v.trim()) {
    playerSearchResults.value = []
    return
  }
  searchDebounceTimer = setTimeout(() => {
    searchPlayers(v)
  }, 300)
}

function selectRecipient(player: IPlayer) {
  if (!selectedRecipients.value.some(r => r.xuid === player.xuid)) {
    selectedRecipients.value.push(player)
  }
  playerSearchResults.value = []
  playerSearchQuery.value = ''
}

function removeRecipient(xuid: string) {
  selectedRecipients.value = selectedRecipients.value.filter(r => r.xuid !== xuid)
}

async function openDetailDialog(mail: IMailItem) {
  selectedMail.value = mail
  detailLoading.value = true
  detailDialogOpen.value = true
  try {
    const res = await getMailDetail(mail.id)
    if (res.code === 200)
      mailDetail.value = res.data
  }
  catch {
    toast.error('获取邮件详情失败')
  }
  finally {
    detailLoading.value = false
  }
}

function openSendDialog() {
  sendForm.content = ''
  sendForm.starQian = 0
  sendForm.scheduledTime = ''
  sendForm.isGlobal = false
  sendForm.items = []
  newItemCount.value = 1
  itemSearchQuery.value = ''
  itemSearchResults.value = []
  snbtInput.value = ''
  actionError.value = ''
  actionResult.value = ''
  playerSearchQuery.value = ''
  playerSearchResults.value = []
  selectedRecipients.value = []
  sendDialogOpen.value = true
}

function removeItem(index: number) {
  sendForm.items.splice(index, 1)
}

function openDeleteDialog(mail: IMailItem) {
  selectedMail.value = mail
  actionError.value = ''
  actionResult.value = ''
  deleteDialogOpen.value = true
}

async function handleSendMail() {
  if (!sendForm.isGlobal && selectedRecipients.value.length === 0) {
    actionError.value = '请选择收件人或选择全局邮件'
    return
  }
  if (!sendForm.content.trim()) {
    actionError.value = '请输入邮件内容'
    return
  }
  actionLoading.value = true
  actionError.value = ''
  try {
    const scheduledTime = sendForm.scheduledTime
      ? sendForm.scheduledTime.replace(/-/g, '.').replace('T', '.').replace(/:/g, '.').slice(0, 19)
      : undefined

    const formattedItems = sendForm.items.map((item) => {
      if (item.type === 'item') {
        return { type: 'item', id: item.id, count: item.count }
      }
      else {
        return { type: 'snbt', snbt: item.snbt }
      }
    })

    if (sendForm.isGlobal) {
      const res = await sendMail({
        toXuid: 'all',
        content: sendForm.content.trim(),
        starQian: sendForm.starQian || undefined,
        scheduledTime,
        items: formattedItems.length > 0 ? formattedItems : undefined,
      })
      if (res.code === 200) {
        actionResult.value = '全局邮件已发送'
        toast.success('全局邮件已发送')
        fetchMails()
      }
      else {
        actionError.value = res.msg || '发送失败'
        toast.error(res.msg || '发送邮件失败')
      }
    }
    else {
      const xuids = selectedRecipients.value.map(r => r.xuid)
      let successCount = 0
      let failCount = 0
      for (const xuid of xuids) {
        try {
          const res = await sendMail({
            toXuid: xuid,
            content: sendForm.content.trim(),
            starQian: sendForm.starQian || undefined,
            scheduledTime,
            items: formattedItems.length > 0 ? formattedItems : undefined,
          })
          if (res.code === 200)
            successCount++
          else
            failCount++
        }
        catch {
          failCount++
        }
      }
      if (successCount > 0) {
        actionResult.value = `已发送给 ${successCount} 位玩家${failCount > 0 ? `，${failCount} 位失败` : ''}`
        toast.success(`已发送给 ${successCount} 位玩家`)
        fetchMails()
      }
      else {
        actionError.value = '发送失败'
        toast.error('发送邮件失败')
      }
    }
  }
  catch {
    actionError.value = '网络错误'
    toast.error('网络错误')
  }
  finally {
    actionLoading.value = false
  }
}

async function handleDeleteMail() {
  if (!selectedMail.value)
    return
  actionLoading.value = true
  actionError.value = ''
  try {
    const res = await deleteMail(selectedMail.value.id)
    if (res.code === 200) {
      actionResult.value = '邮件已删除'
      toast.success('邮件已删除')
      table.resetRowSelection() // 清除选中状态
      fetchMails()
    }
    else {
      actionError.value = res.msg || '删除失败'
      toast.error(res.msg || '删除邮件失败')
    }
  }
  catch {
    actionError.value = '网络错误'
    toast.error('网络错误')
  }
  finally {
    actionLoading.value = false
  }
}

function openBatchDeleteDialog() {
  actionError.value = ''
  actionResult.value = ''
  batchDeleteDialogOpen.value = true
}

const isAllSelected = computed(() => {
  if (!table)
    return false
  return table.getIsAllPageRowsSelected()
})

function selectAll() {
  table.toggleAllPageRowsSelected(!isAllSelected.value)
}

async function handleBatchDelete() {
  actionLoading.value = true
  actionError.value = ''
  try {
    let successCount = 0
    let failCount = 0
    for (const id of selectedMailIds.value) {
      try {
        const res = await deleteMail(id)
        if (res.code === 200)
          successCount++
        else
          failCount++
      }
      catch {
        failCount++
      }
    }
    if (successCount > 0) {
      actionResult.value = `已删除 ${successCount} 封邮件${failCount > 0 ? `，${failCount} 封失败` : ''}`
      toast.success(`已删除 ${successCount} 封邮件`)
      table.resetRowSelection()
      fetchMails()
    }
    else {
      actionError.value = '删除失败'
      toast.error('删除邮件失败')
    }
  }
  catch {
    actionError.value = '网络错误'
    toast.error('网络错误')
  }
  finally {
    actionLoading.value = false
  }
}

const serverPagination = computed(() => ({
  page: currentPage.value,
  pageSize: pageSize.value,
  total: total.value,
  onPageChange: handlePageChange,
  onPageSizeChange: handlePageSizeChange,
}))

const columns: ColumnDef<IMailItem>[] = [
  {
    id: 'select',
    header: ({ table }) => h('div', { class: 'flex items-center justify-center' }, [
      h('input', {
        type: 'checkbox',
        class: 'h-4 w-4 rounded border-gray-300',
        checked: table.getIsAllPageRowsSelected(),
        indeterminate: table.getIsSomePageRowsSelected(),
        onChange: (e: Event) => table.toggleAllPageRowsSelected((e.target as HTMLInputElement).checked),
      }),
    ]),
    cell: ({ row }) => h('div', { class: 'flex items-center justify-center' }, [
      h('input', {
        type: 'checkbox',
        class: 'h-4 w-4 rounded border-gray-300',
        checked: row.getIsSelected(),
        onChange: (e: Event) => row.toggleSelected((e.target as HTMLInputElement).checked),
      }),
    ]),
    enableSorting: false,
    enableResizing: false,
    size: 40,
  },
  {
    accessorKey: 'id',
    header: () => h('div', { class: 'text-sm font-medium' }, 'ID'),
    cell: ({ row }) => h('div', { class: 'font-mono text-xs' }, row.original.id),
    enableSorting: false,
    enableResizing: true,
    size: 60,
  },
  {
    accessorKey: 'fromName',
    header: () => h('div', { class: 'text-sm font-medium' }, '发件人'),
    cell: ({ row }) => h('div', {}, [
      h('div', { class: 'text-sm' }, row.original.fromName),
      h('div', { class: 'text-xs text-muted-foreground font-mono' }, row.original.fromXuid),
    ]),
    enableSorting: false,
    enableResizing: true,
    size: 150,
  },
  {
    accessorKey: 'toName',
    header: () => h('div', { class: 'text-sm font-medium' }, '收件人'),
    cell: ({ row }) => {
      if (row.original.isGlobal)
        return h('div', { class: 'text-sm text-blue-600' }, '全体玩家')
      return h('div', {}, [
        h('div', { class: 'text-sm' }, row.original.toName),
        h('div', { class: 'text-xs text-muted-foreground font-mono' }, row.original.toXuid),
      ])
    },
    enableSorting: false,
    enableResizing: true,
    size: 150,
  },
  {
    accessorKey: 'content',
    header: () => h('div', { class: 'text-sm font-medium' }, '内容'),
    cell: ({ row }) => h('div', { class: 'truncate text-sm' }, row.original.content),
    enableSorting: false,
    enableResizing: true,
    size: 200,
  },
  {
    accessorKey: 'starQian',
    header: () => h('div', { class: 'text-sm font-medium' }, '星币'),
    cell: ({ row }) => h('div', { class: 'font-mono' }, row.original.starQian > 0 ? row.original.starQian.toLocaleString() : '-'),
    enableSorting: false,
    enableResizing: true,
    size: 80,
  },
  {
    accessorKey: 'type',
    header: () => h('div', { class: 'text-sm font-medium' }, '类型'),
    cell: ({ row }) => {
      const badges: any[] = []
      if (row.original.isGlobal)
        badges.push(h('span', { class: 'text-blue-600 text-xs font-semibold' }, '全局'))
      if (row.original.isScheduled)
        badges.push(h('span', { class: 'text-orange-600 text-xs font-semibold' }, '定时'))
      if (!row.original.isGlobal && !row.original.isScheduled)
        badges.push(h('span', { class: 'text-xs font-semibold' }, '个人'))
      return h('div', { class: 'flex flex-col gap-0.5' }, badges)
    },
    enableSorting: false,
    enableResizing: true,
    size: 80,
  },
  {
    accessorKey: 'status',
    header: () => h('div', { class: 'text-sm font-medium' }, '状态'),
    cell: ({ row }) => {
      if (row.original.isGlobal) {
        return h('div', { class: 'text-xs space-y-0.5' }, [
          h('div', { class: 'text-green-600' }, `已读 ${row.original.readCount}`),
          h('div', { class: 'text-blue-600' }, `已领 ${row.original.claimedCount}`),
        ])
      }
      const isRead = row.original.read === true
      return h('div', { class: 'text-xs' }, [
        h('span', { class: isRead ? 'text-green-600' : 'text-orange-500' }, isRead ? '已读' : '未读'),
      ])
    },
    enableSorting: false,
    enableResizing: true,
    size: 80,
  },
  {
    accessorKey: 'time',
    header: () => h('div', { class: 'text-sm font-medium' }, '时间'),
    cell: ({ row }) => h('div', { class: 'text-xs' }, formatTime(row.original.time)),
    enableSorting: false,
    enableResizing: true,
    size: 140,
  },
  {
    id: 'actions',
    header: () => h('div', {}, '操作'),
    cell: ({ row }) => {
      return h('div', { class: 'flex items-center gap-1' }, [
        h('button', {
          class: 'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-2',
          onClick: () => openDetailDialog(row.original),
        }, '详情'),
        h('button', {
          class: 'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-2 text-destructive',
          onClick: () => openDeleteDialog(row.original),
        }, '删除'),
      ])
    },
    enableSorting: false,
    enablePinning: false,
    enableResizing: false,
    size: 120,
  },
]

const tableProps = reactive({
  columns,
  data: mails,
  serverPagination,
})

const table = useGenerateVueTable<IMailItem>(tableProps)

onMounted(() => {
  fetchMails()
})
</script>

<template>
  <BasicPage title="邮件管理" description="管理玩家邮件发送与查看" sticky>
    <div class="space-y-4">
      <!-- 操作栏：所有按钮和搜索在同一行 -->
      <div class="flex items-center gap-2">
        <UiInput
          v-model="searchQuery"
          placeholder="搜索发件人 / 收件人 / XUID"
          class="w-[200px] sm:w-[250px] shrink-0"
          @keydown.enter="handleSearch"
        />
        <UiButton variant="outline" size="icon" class="shrink-0" @click="handleSearch">
          <SearchIcon class="size-4" />
        </UiButton>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-sm text-muted-foreground">类型:</span>
          <UiSelect :model-value="typeFilter" @update:model-value="handleTypeChange">
            <UiSelectTrigger class="w-[120px]">
              <UiSelectValue />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </UiSelectItem>
            </UiSelectContent>
          </UiSelect>
        </div>
        <span class="text-sm text-muted-foreground shrink-0">
          共 {{ total }} 封
        </span>
        <div class="flex-1 min-w-4" />
        <UiButton variant="outline" size="sm" class="shrink-0" @click="selectAll">
          {{ isAllSelected ? '取消全选' : '全选' }}
        </UiButton>
        <UiButton variant="destructive" size="sm" class="min-w-[104px] shrink-0" :disabled="selectedMailIds.length === 0" @click="openBatchDeleteDialog">
          <Trash2Icon class="size-4 mr-1" />
          删除选中 ({{ selectedMailIds.length }})
        </UiButton>
        <UiButton variant="outline" size="sm" class="shrink-0" @click="handleRefresh">
          刷新
        </UiButton>
        <UiButton size="sm" class="shrink-0" @click="openSendDialog">
          <SendIcon class="size-4 mr-1" />
          发送邮件
        </UiButton>
      </div>

      <div class="overflow-x-auto">
        <DataTable :loading :data="mails" :columns :table :server-pagination="serverPagination" />
      </div>
    </div>

    <UiDialog v-model:open="detailDialogOpen">
      <UiDialogContent class="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
        <UiDialogHeader>
          <UiDialogTitle>邮件详情</UiDialogTitle>
          <UiDialogDescription>
            邮件 #{{ selectedMail?.id }}
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="detailLoading" class="flex items-center justify-center py-8">
          <UiSpinner class="size-6" />
        </div>
        <div v-else-if="mailDetail" class="space-y-4 py-2">
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="space-y-1">
              <span class="text-muted-foreground">发件人</span>
              <p>{{ mailDetail.fromName }} ({{ mailDetail.fromXuid }})</p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">收件人</span>
              <p v-if="mailDetail.isGlobal">
                全体玩家
              </p>
              <p v-else>
                {{ mailDetail.toName }} ({{ mailDetail.toXuid }})
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">发送时间</span>
              <p>{{ formatTime(mailDetail.time) }}</p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">星币</span>
              <p class="font-mono">
                {{ mailDetail.starQian > 0 ? mailDetail.starQian.toLocaleString() : '-' }}
              </p>
            </div>
          </div>
          <UiSeparator />
          <div>
            <span class="text-muted-foreground text-sm">内容</span>
            <p class="mt-1 text-sm whitespace-pre-wrap">
              {{ mailDetail.content }}
            </p>
          </div>
          <template v-if="mailDetail.items && mailDetail.items.length > 0">
            <UiSeparator />
            <div>
              <span class="text-muted-foreground text-sm">附带物品</span>
              <div class="mt-1 space-y-1">
                <div v-for="(item, i) in mailDetail.items" :key="i" class="text-sm flex items-center gap-2">
                  <span class="font-medium">{{ item.name }}</span>
                  <span class="text-muted-foreground">x{{ item.count }}</span>
                </div>
              </div>
            </div>
          </template>
          <template v-if="mailDetail.isScheduled && mailDetail.scheduledTime">
            <UiSeparator />
            <div>
              <span class="text-muted-foreground text-sm">定时发送</span>
              <p class="mt-1 text-sm">
                {{ formatTime(mailDetail.scheduledTime) }}
              </p>
            </div>
          </template>
          <template v-if="mailDetail.isGlobal && mailDetail.readList">
            <UiSeparator />
            <div>
              <span class="text-muted-foreground text-sm">已读 ({{ mailDetail.readList.length }})</span>
              <div class="mt-1 flex flex-wrap gap-1">
                <Badge v-for="r in mailDetail.readList" :key="r.xuid" variant="outline" class="text-xs">
                  {{ r.name }}
                </Badge>
              </div>
            </div>
          </template>
          <template v-if="mailDetail.isGlobal && mailDetail.claimedList">
            <UiSeparator />
            <div>
              <span class="text-muted-foreground text-sm">已领取 ({{ mailDetail.claimedList.length }})</span>
              <div class="mt-1 flex flex-wrap gap-1">
                <Badge v-for="c in mailDetail.claimedList" :key="c.xuid" variant="outline" class="text-xs">
                  {{ c.name }}
                </Badge>
              </div>
            </div>
          </template>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="detailDialogOpen = false">
            关闭
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="sendDialogOpen">
      <UiDialogContent class="sm:max-w-[550px] max-h-[85vh] flex flex-col">
        <UiDialogHeader>
          <UiDialogTitle>发送邮件</UiDialogTitle>
          <UiDialogDescription>
            向指定玩家发送邮件
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!actionResult" class="space-y-4 py-4 overflow-y-auto flex-1">
          <div class="flex items-center gap-2">
            <UiCheckbox id="isGlobal" v-model="isGlobalMail" />
            <label for="isGlobal" class="text-sm font-medium">全局邮件（发送给所有玩家）</label>
          </div>
          <div v-if="!isGlobalMail" class="space-y-2">
            <label class="text-sm font-medium">收件人 ({{ selectedRecipients.length }}人)</label>
            <div v-if="selectedRecipients.length > 0" class="flex flex-wrap gap-1.5">
              <span
                v-for="r in selectedRecipients"
                :key="r.xuid"
                class="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"
              >
                <span class="font-medium">{{ r.name }}</span>
                <span class="text-muted-foreground font-mono">{{ r.uid }}</span>
                <button
                  class="ml-0.5 text-destructive hover:text-destructive/80"
                  @click="removeRecipient(r.xuid)"
                >
                  ×
                </button>
              </span>
            </div>
            <div class="relative">
              <UiInput
                :model-value="playerSearchQuery"
                placeholder="搜索玩家名 / UID / XUID 添加收件人"
                @update:model-value="handlePlayerSearchInput"
              />
              <div v-if="playerSearchLoading" class="absolute right-2 top-1/2 -translate-y-1/2">
                <UiSpinner class="size-4" />
              </div>
              <div v-if="playerSearchResults.length > 0" class="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-[200px] overflow-y-auto">
                <button
                  v-for="p in playerSearchResults"
                  :key="p.xuid"
                  class="w-full text-left px-3 py-2 hover:bg-accent transition-colors border-b last:border-b-0"
                  @click="selectRecipient(p)"
                >
                  <div class="text-sm font-medium">
                    {{ p.name }}
                  </div>
                  <div class="text-xs text-muted-foreground font-mono">
                    UID: {{ p.uid }} | XUID: {{ p.xuid }}
                  </div>
                </button>
              </div>
            </div>
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">邮件内容</label>
            <UiTextarea v-model="sendForm.content" placeholder="请输入邮件内容" :rows="4" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">附带星币（可选）</label>
              <UiInput v-model="sendForm.starQian" type="number" placeholder="0" :min="0" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">定时发送（可选）</label>
              <UiInput v-model="sendForm.scheduledTime" type="datetime-local" />
            </div>
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">附带物品（可选，最多10个）</label>
            <div class="space-y-2 border rounded-md p-3">
              <div class="space-y-1">
                <span class="text-xs text-muted-foreground">搜索普通物品</span>
                <div class="relative">
                  <div class="flex items-center gap-2">
                    <UiInput :model-value="itemSearchQuery" placeholder="搜索物品名称或ID" class="flex-1" @update:model-value="handleItemSearch" />
                    <UiInput v-model="newItemCount" type="number" placeholder="数量" class="w-20" :min="1" />
                    <UiButton variant="outline" size="sm" :disabled="!itemSearchResults.length" @click="itemSearchResults.length && selectItem(itemSearchResults[0])">
                      添加
                    </UiButton>
                  </div>
                  <div v-if="itemSearchLoading" class="absolute right-3 top-1/2 -translate-y-1/2">
                    <UiSpinner class="size-4" />
                  </div>
                  <div v-if="itemSearchResults.length > 0" class="absolute z-50 w-full mt-1 border rounded-md max-h-40 overflow-y-auto bg-popover shadow-md">
                    <div
                      v-for="item in itemSearchResults"
                      :key="item.id"
                      class="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm border-b last:border-b-0"
                      @click="selectItem(item)"
                    >
                      <ItemTexture :texture="item.image" :size="20" />
                      <span class="font-medium">{{ item.name }}</span>
                      <span class="text-muted-foreground text-xs ml-auto">{{ item.id }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="space-y-1">
                <span class="text-xs text-muted-foreground">SNBT物品输入</span>
                <div class="flex items-center gap-2">
                  <UiTextarea v-model="snbtInput" placeholder="{&quot;Count&quot;:1b,&quot;Damage&quot;:0s,&quot;Name&quot;:&quot;minecraft:redstone&quot;,&quot;WasPickedUp&quot;:0b}" class="flex-1" :rows="2" />
                  <UiButton variant="outline" size="sm" @click="addSnbtItem">
                    添加
                  </UiButton>
                </div>
              </div>
            </div>
            <div v-if="sendForm.items.length > 0" class="space-y-1 mt-2">
              <div v-for="(item, i) in sendForm.items" :key="i" class="flex items-center gap-2 text-sm bg-muted rounded-md px-2 py-1">
                <span class="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{{ item.type === 'item' ? '物品' : 'SNBT' }}</span>
                <span class="flex-1 truncate">{{ item.displayName || (item.type === 'item' ? item.id : item.snbt) }}</span>
                <span class="text-muted-foreground">x{{ item.count }}</span>
                <button class="text-destructive hover:underline text-xs" @click="removeItem(i)">
                  移除
                </button>
              </div>
            </div>
          </div>
          <div v-if="actionError" class="text-sm text-destructive">
            {{ actionError }}
          </div>
        </div>
        <div v-else class="py-4">
          <div class="rounded-md bg-muted p-3 text-sm">
            {{ actionResult }}
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="sendDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleSendMail">
            <SendIcon class="size-4 mr-2" />
            {{ actionLoading ? '发送中...' : '发送' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="deleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>删除邮件</UiDialogTitle>
          <UiDialogDescription>
            确定要删除邮件 #{{ selectedMail?.id }} 吗？此操作不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!actionResult" class="py-4">
          <div v-if="actionError" class="text-sm text-destructive">
            {{ actionError }}
          </div>
        </div>
        <div v-else class="py-4">
          <div class="rounded-md bg-muted p-3 text-sm">
            {{ actionResult }}
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="deleteDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" variant="destructive" :disabled="actionLoading" @click="handleDeleteMail">
            {{ actionLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="batchDeleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>批量删除邮件</UiDialogTitle>
          <UiDialogDescription>
            确定要删除选中的 {{ selectedMailIds.length }} 封邮件吗？此操作不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!actionResult" class="py-4">
          <div v-if="actionError" class="text-sm text-destructive">
            {{ actionError }}
          </div>
        </div>
        <div v-else class="py-4">
          <div class="rounded-md bg-muted p-3 text-sm">
            {{ actionResult }}
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="batchDeleteDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" variant="destructive" :disabled="actionLoading" @click="handleBatchDelete">
            {{ actionLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>
  </BasicPage>
</template>
