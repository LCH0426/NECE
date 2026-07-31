<script setup lang="ts">
import { PlusIcon, SearchIcon, TrashIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IWhitelistItem } from '@/services/api/whitelist.api'

import { BasicPage } from '@/components/global-layout'
import { useWhitelistApi } from '@/services/api/whitelist.api'

const { getWhitelist, addWhitelist, deleteWhitelist } = useWhitelistApi()

const whitelist = ref<IWhitelistItem[]>([])
const loading = ref(true)
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const searchQuery = ref('')

const selectedNames = ref<Set<string>>(new Set())
const batchDeleteDialogOpen = ref(false)
const batchDeleteLoading = ref(false)

const isAllSelected = computed(() => {
  return whitelist.value.length > 0 && whitelist.value.every(i => selectedNames.value.has(i.name))
})
const isIndeterminate = computed(() => {
  const selected = whitelist.value.filter(i => selectedNames.value.has(i.name)).length
  return selected > 0 && selected < whitelist.value.length
})

function toggleSelectAll() {
  if (isAllSelected.value) {
    const filteredNames = new Set(whitelist.value.map(i => i.name))
    const newSet = new Set(selectedNames.value)
    for (const name of filteredNames)
      newSet.delete(name)
    selectedNames.value = newSet
  }
  else {
    const newSet = new Set(selectedNames.value)
    for (const item of whitelist.value)
      newSet.add(item.name)
    selectedNames.value = newSet
  }
}

function toggleSelect(name: string) {
  const s = new Set(selectedNames.value)
  if (s.has(name))
    s.delete(name)
  else s.add(name)
  selectedNames.value = s
}

async function handleBatchDelete() {
  if (selectedNames.value.size === 0)
    return
  batchDeleteDialogOpen.value = true
}

async function confirmBatchDelete() {
  batchDeleteLoading.value = true
  let success = 0
  let fail = 0
  for (const name of selectedNames.value) {
    try {
      const res = await deleteWhitelist({ name })
      if (res.code === 200)
        success++
      else fail++
    }
    catch {
      fail++
    }
  }
  batchDeleteLoading.value = false
  selectedNames.value = new Set()
  batchDeleteDialogOpen.value = false
  if (fail === 0)
    toast.success(`批量移除成功 (${success}个)`)
  else toast.warning(`移除完成：成功${success}个，失败${fail}个`)
  fetchWhitelist()
}

async function fetchWhitelist() {
  loading.value = true
  try {
    const query: Record<string, any> = {
      page: currentPage.value,
      pageSize: pageSize.value,
    }
    if (searchQuery.value.trim())
      query.search = searchQuery.value.trim()

    const res = await getWhitelist(query as any)
    if (res.code === 200) {
      whitelist.value = res.data.list
      total.value = res.data.pagination.total
    }
  }
  catch {
    toast.error('获取白名单失败')
  }
  finally {
    loading.value = false
  }
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchWhitelist()
}

function handleSearch() {
  currentPage.value = 1
  fetchWhitelist()
  toast.success('已刷新白名单列表')
}

function handleRefresh() {
  fetchWhitelist()
  toast.success('已刷新白名单列表')
}

const addDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const selectedItem = ref<IWhitelistItem | null>(null)
const addForm = reactive({ name: '' })
const actionLoading = ref(false)
const actionError = ref('')
const actionResult = ref('')

function openAddDialog() {
  addForm.name = ''
  actionError.value = ''
  actionResult.value = ''
  addDialogOpen.value = true
}

function openDeleteDialog(item: IWhitelistItem) {
  selectedItem.value = item
  actionError.value = ''
  actionResult.value = ''
  deleteDialogOpen.value = true
}

async function handleAddWhitelist() {
  if (!addForm.name.trim()) {
    actionError.value = '请输入玩家名'
    return
  }
  actionLoading.value = true
  actionError.value = ''
  try {
    const res = await addWhitelist({ name: addForm.name.trim() })
    if (res.code === 200) {
      actionResult.value = `已添加 ${addForm.name} 到白名单`
      toast.success(`已添加 ${addForm.name} 到白名单`)
      fetchWhitelist()
    }
    else {
      actionError.value = res.msg || '添加失败'
      toast.error(res.msg || '添加白名单失败')
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

async function handleDeleteWhitelist() {
  if (!selectedItem.value)
    return
  actionLoading.value = true
  actionError.value = ''
  try {
    const res = await deleteWhitelist({ name: selectedItem.value.name })
    if (res.code === 200) {
      actionResult.value = `已将 ${selectedItem.value.name} 从白名单移除`
      toast.success(`已将 ${selectedItem.value.name} 从白名单移除`)
      fetchWhitelist()
    }
    else {
      actionError.value = res.msg || '删除失败'
      toast.error(res.msg || '移除白名单失败')
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

const totalPages = computed(() => Math.ceil(total.value / pageSize.value) || 1)

onMounted(() => {
  fetchWhitelist()
})
</script>

<template>
  <BasicPage title="白名单管理" description="管理服务器白名单" sticky>
    <template #actions>
      <div class="flex items-center gap-2">
        <UiButton variant="outline" size="sm" @click="handleRefresh">
          刷新
        </UiButton>
        <UiButton @click="openAddDialog">
          <PlusIcon class="size-4 mr-2" />
          添加白名单
        </UiButton>
      </div>
    </template>

    <div class="space-y-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <UiInput
            v-model="searchQuery"
            placeholder="搜索玩家名 / XUID"
            class="w-[250px]"
            @keydown.enter="handleSearch"
          />
          <UiButton variant="outline" size="icon" @click="handleSearch">
            <SearchIcon class="size-4" />
          </UiButton>
        </div>
        <span class="text-sm text-muted-foreground">
          共 {{ total }} 个白名单玩家
        </span>
        <div class="flex-1" />
        <UiButton
          v-if="selectedNames.size > 0"
          variant="destructive"
          size="sm"
          :disabled="batchDeleteLoading"
          @click="handleBatchDelete"
        >
          <TrashIcon class="size-4 mr-1" />
          批量移除 ({{ selectedNames.size }})
        </UiButton>
      </div>

      <div v-if="loading" class="flex items-center justify-center py-12">
        <UiSpinner class="size-6" />
      </div>

      <div v-else class="border rounded-lg">
        <div class="grid grid-cols-[40px_1fr_1fr_120px_80px] gap-4 px-4 py-3 border-b text-xs text-muted-foreground font-medium items-center">
          <UiCheckbox
            :model-value="isAllSelected || (isIndeterminate ? 'indeterminate' : false)"
            @update:model-value="toggleSelectAll"
          />
          <span>玩家名</span>
          <span>XUID</span>
          <span>忽略人数限制</span>
          <span>操作</span>
        </div>
        <div v-if="whitelist.length === 0" class="p-4 text-center text-muted-foreground text-sm">
          暂无白名单玩家
        </div>
        <div
          v-for="item in whitelist"
          :key="item.name"
          class="grid grid-cols-[40px_1fr_1fr_120px_80px] gap-4 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 items-center"
        >
          <UiCheckbox
            :model-value="selectedNames.has(item.name)"
            @update:model-value="toggleSelect(item.name)"
          />
          <span class="text-sm font-medium">{{ item.name }}</span>
          <span class="text-sm font-mono text-muted-foreground">{{ item.xuid }}</span>
          <span class="text-sm">{{ item.ignoresPlayerLimit ? '是' : '否' }}</span>
          <div class="flex items-center gap-1">
            <UiButton variant="ghost" size="icon" class="size-8 text-destructive" @click="openDeleteDialog(item)">
              <TrashIcon class="size-4" />
            </UiButton>
          </div>
        </div>
      </div>

      <div v-if="totalPages > 1" class="flex items-center justify-center gap-2">
        <UiButton
          variant="outline"
          size="sm"
          :disabled="currentPage <= 1"
          @click="handlePageChange(currentPage - 1)"
        >
          上一页
        </UiButton>
        <span class="text-sm text-muted-foreground">
          {{ currentPage }} / {{ totalPages }}
        </span>
        <UiButton
          variant="outline"
          size="sm"
          :disabled="currentPage >= totalPages"
          @click="handlePageChange(currentPage + 1)"
        >
          下一页
        </UiButton>
      </div>
    </div>

    <UiDialog v-model:open="batchDeleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>批量移除白名单</UiDialogTitle>
          <UiDialogDescription>
            确定要将选中的 {{ selectedNames.size }} 个玩家从白名单中移除吗？
          </UiDialogDescription>
        </UiDialogHeader>
        <UiDialogFooter>
          <UiButton variant="outline" @click="batchDeleteDialogOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" :disabled="batchDeleteLoading" @click="confirmBatchDelete">
            {{ batchDeleteLoading ? '移除中...' : '确认移除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="addDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>添加白名单</UiDialogTitle>
          <UiDialogDescription>
            将玩家添加到服务器白名单
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!actionResult" class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">玩家名</label>
            <UiInput v-model="addForm.name" placeholder="请输入玩家名" />
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
          <UiButton variant="outline" @click="addDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleAddWhitelist">
            {{ actionLoading ? '处理中...' : '确认添加' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="deleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>移除白名单</UiDialogTitle>
          <UiDialogDescription>
            确定要将 {{ selectedItem?.name }} 从白名单中移除吗？
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
          <UiButton v-if="!actionResult" variant="destructive" :disabled="actionLoading" @click="handleDeleteWhitelist">
            {{ actionLoading ? '处理中...' : '确认移除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>
  </BasicPage>
</template>
