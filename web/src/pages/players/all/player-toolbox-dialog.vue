<script setup lang="ts">
import { CheckCircle2Icon, SettingsIcon, TrashIcon, UsersIcon, WrenchIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IUnassignedPlayer } from '@/services/api/playtime.api'
import type { INonAllowlistPlayer } from '@/services/api/whitelist.api'

import { usePlaytimeApi } from '@/services/api/playtime.api'
import { useWhitelistApi } from '@/services/api/whitelist.api'

const open = defineModel<boolean>('open', { default: false })

const { getUnassignedPlayers, postBatchRandomAssign } = usePlaytimeApi()
const { getNotInAllowlist, postDeleteBatch } = useWhitelistApi()

const activeTab = ref('assign')

// ========== Tab1 批量重新分配热力图 ==========
const assignLoading = ref(false)
const unassignedPlayers = ref<IUnassignedPlayer[]>([])
const assignTotal = ref(0)
const assignEndType = ref<'last' | 'now'>('last')
const assigning = ref(false)
const assignProgress = ref(0)
const assignDone = ref(false)
const assignResult = ref<{ success: number, fail: number } | null>(null)

async function fetchUnassigned() {
  assignLoading.value = true
  try {
    const res = await getUnassignedPlayers()
    if (res.code === 200) {
      unassignedPlayers.value = res.data.players
      assignTotal.value = res.data.total
      assignDone.value = false
      assignProgress.value = 0
      assignResult.value = null
    }
    else {
      toast.error(res.msg || '获取未分配玩家失败')
    }
  }
  catch {
    toast.error('获取未分配玩家失败')
  }
  finally {
    assignLoading.value = false
  }
}

async function startAssign() {
  const xuids = unassignedPlayers.value.map(p => p.xuid)
  if (xuids.length === 0)
    return
  assigning.value = true
  assignProgress.value = 0
  assignDone.value = false
  assignResult.value = null
  let success = 0
  let fail = 0
  const chunkSize = 10
  for (let i = 0; i < xuids.length; i += chunkSize) {
    const chunk = xuids.slice(i, i + chunkSize)
    try {
      const res = await postBatchRandomAssign({ xuids: chunk, endType: assignEndType.value })
      if (res.code === 200) {
        success += res.data.successCount
        fail += res.data.failCount
      }
      else {
        fail += chunk.length
      }
    }
    catch {
      fail += chunk.length
    }
    assignProgress.value = Math.min(i + chunk.length, xuids.length)
  }
  assignResult.value = { success, fail }
  assignDone.value = true
  assigning.value = false
  if (fail === 0)
    toast.success(`批量分配完成，成功 ${success} 人`)
  else
    toast.warning(`批量分配完成：成功${success}人，失败${fail}人`)
  fetchUnassigned()
}

// ========== Tab2 不在白名单删除 ==========
const notInLoading = ref(false)
const notInPlayers = ref<INonAllowlistPlayer[]>([])
const notInTotal = ref(0)
const notInPage = ref(1)
const notInPageSize = ref(10)
const notInPages = ref(1)
const notInSearch = ref('')
const selectedXuids = ref<Set<string>>(new Set())
const deleteConfirmOpen = ref(false)
const deleting = ref(false)
const deleteProgress = ref(0)
const deleteDone = ref(false)
const deleteResult = ref<{ success: number, fail: number } | null>(null)

async function fetchNotInAllowlist() {
  notInLoading.value = true
  try {
    const res = await getNotInAllowlist({
      page: notInPage.value,
      pageSize: notInPageSize.value,
      search: notInSearch.value || undefined,
    })
    if (res.code === 200) {
      notInPlayers.value = res.data.list
      notInTotal.value = res.data.pagination.total
      notInPages.value = res.data.pagination.totalPages || 1
    }
    else {
      toast.error(res.msg || '获取不在白名单玩家失败')
    }
  }
  catch {
    toast.error('获取不在白名单玩家失败')
  }
  finally {
    notInLoading.value = false
  }
}

const currentPageSelectedAll = computed(() => {
  return notInPlayers.value.length > 0 && notInPlayers.value.every(p => selectedXuids.value.has(p.xuid))
})

const currentPageSelectedSome = computed(() => {
  const count = notInPlayers.value.filter(p => selectedXuids.value.has(p.xuid)).length
  return count > 0 && count < notInPlayers.value.length
})

function toggleSelectAll() {
  if (currentPageSelectedAll.value) {
    for (const p of notInPlayers.value)
      selectedXuids.value.delete(p.xuid)
    selectedXuids.value = new Set(selectedXuids.value)
  }
  else {
    const s = new Set(selectedXuids.value)
    for (const p of notInPlayers.value)
      s.add(p.xuid)
    selectedXuids.value = s
  }
}

function toggleSelect(xuid: string) {
  const s = new Set(selectedXuids.value)
  if (s.has(xuid))
    s.delete(xuid)
  else
    s.add(xuid)
  selectedXuids.value = s
}

function searchNotIn() {
  notInPage.value = 1
  fetchNotInAllowlist()
}

function prevPage() {
  if (notInPage.value > 1) {
    notInPage.value--
    fetchNotInAllowlist()
  }
}

function nextPage() {
  if (notInPage.value < notInPages.value) {
    notInPage.value++
    fetchNotInAllowlist()
  }
}

async function confirmDelete() {
  const xuids = [...selectedXuids.value]
  if (xuids.length === 0)
    return
  deleteConfirmOpen.value = false
  deleting.value = true
  deleteProgress.value = 0
  deleteDone.value = false
  deleteResult.value = null
  let success = 0
  let fail = 0
  const chunkSize = 10
  for (let i = 0; i < xuids.length; i += chunkSize) {
    const chunk = xuids.slice(i, i + chunkSize)
    try {
      const res = await postDeleteBatch({ xuids: chunk })
      if (res.code === 200) {
        success += res.data.successCount
        fail += res.data.failCount
      }
      else {
        fail += chunk.length
      }
    }
    catch {
      fail += chunk.length
    }
    deleteProgress.value = Math.min(i + chunk.length, xuids.length)
  }
  deleteResult.value = { success, fail }
  deleteDone.value = true
  deleting.value = false
  selectedXuids.value = new Set()
  if (fail === 0)
    toast.success(`批量删除完成，共删除 ${success} 人`)
  else
    toast.warning(`批量删除完成：成功${success}人，失败${fail}人`)
  fetchNotInAllowlist()
}

// ========== 工具函数 ==========
function formatDuration(seconds: number) {
  if (!seconds || seconds <= 0)
    return '无记录'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  if (d > 0)
    return `${d} 天 ${h} 小时`
  if (h > 0)
    return `${h} 小时`
  return `${Math.floor(seconds / 60)} 分钟`
}

function formatDateTime(s?: string) {
  if (!s)
    return '-'
  const d = new Date(/^\d+$/.test(s) ? Number(s) : s.replace(/-/g, '/'))
  if (Number.isNaN(d.getTime()))
    return s
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

watch(() => open.value, (v) => {
  if (v) {
    activeTab.value = 'assign'
    fetchUnassigned()
    selectedXuids.value = new Set()
    deleteDone.value = false
    deleteResult.value = null
  }
})

watch(activeTab, (tab) => {
  if (tab === 'delete')
    fetchNotInAllowlist()
})
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="sm:max-w-[1100px] max-h-[88vh] flex flex-col">
      <UiDialogHeader>
        <UiDialogTitle class="flex items-center gap-2">
          <WrenchIcon class="size-5" />
          玩家管理工具
        </UiDialogTitle>
        <UiDialogDescription>
          批量热力图分配与不在白名单玩家数据清理
        </UiDialogDescription>
      </UiDialogHeader>

      <UiTabs v-model="activeTab" class="flex-1 min-h-0 flex flex-col">
        <UiTabsList>
          <UiTabsTrigger value="assign">
            <SettingsIcon class="size-4 mr-1" />
            批量分配热力图
          </UiTabsTrigger>
          <UiTabsTrigger value="delete">
            <UsersIcon class="size-4 mr-1" />
            不在白名单删除
          </UiTabsTrigger>
        </UiTabsList>

        <!-- ==================== Tab1 批量分配热力图 ==================== -->
        <UiTabsContent value="assign" class="flex-1 min-h-0 flex flex-col gap-3 mt-4">
          <div v-if="assignLoading" class="flex items-center justify-center py-16">
            <UiSpinner class="size-6" />
          </div>

          <template v-else>
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm text-muted-foreground">
                待分配玩家：<span class="font-mono font-bold text-foreground">{{ assignTotal }}</span> 人
              </div>
              <div v-if="!assignDone && assignTotal > 0" class="flex items-center gap-3">
                <label class="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input v-model="assignEndType" type="radio" value="last">
                  最后登录
                </label>
                <label class="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input v-model="assignEndType" type="radio" value="now">
                  当前时间
                </label>
                <UiButton size="sm" :disabled="assigning" @click="startAssign">
                  {{ assigning ? '分配中...' : '开始分配' }}
                </UiButton>
              </div>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto rounded-md border">
              <table class="w-full text-sm">
                <thead class="sticky top-0 bg-muted/50">
                  <tr>
                    <th class="text-left font-medium px-3 py-2">
                      玩家名
                    </th>
                    <th class="text-left font-medium px-3 py-2">
                      XUID
                    </th>
                    <th class="text-left font-medium px-3 py-2">
                      总时长
                    </th>
                    <th class="text-left font-medium px-3 py-2">
                      最后登录
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in unassignedPlayers" :key="p.xuid" class="border-t">
                    <td class="px-3 py-1.5 font-medium">
                      {{ p.name }}
                    </td>
                    <td class="px-3 py-1.5 font-mono text-xs">
                      {{ p.xuid }}
                    </td>
                    <td class="px-3 py-1.5 font-mono text-xs">
                      {{ formatDuration(p.playTime) }}
                    </td>
                    <td class="px-3 py-1.5 text-xs">
                      {{ formatDateTime(p.leavetime) }}
                    </td>
                  </tr>
                  <tr v-if="unassignedPlayers.length === 0">
                    <td colspan="4" class="px-3 py-10 text-center text-sm text-muted-foreground">
                      所有玩家已完成热力图分配
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="assigning" class="space-y-1.5">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>正在分配热力图...</span>
                <span class="font-mono">{{ assignProgress }} / {{ assignTotal }}</span>
              </div>
              <UiProgress :model-value="assignTotal > 0 ? Math.round(assignProgress / assignTotal * 100) : 0" />
            </div>

            <div v-if="assignDone" class="rounded-md border p-4 flex items-center gap-3">
              <CheckCircle2Icon class="size-6 text-green-500" />
              <div class="text-sm">
                <p class="font-medium">
                  分配完成
                </p>
                <p class="text-muted-foreground">
                  成功 <span class="font-mono">{{ assignResult?.success ?? 0 }}</span> 人，失败
                  <span class="font-mono">{{ assignResult?.fail ?? 0 }}</span> 人
                </p>
              </div>
              <UiButton variant="outline" size="sm" class="ml-auto" @click="fetchUnassigned">
                重新统计
              </UiButton>
            </div>
          </template>
        </UiTabsContent>

        <!-- ==================== Tab2 不在白名单删除 ==================== -->
        <UiTabsContent value="delete" class="flex-1 min-h-0 flex flex-col gap-3 mt-4">
          <div class="flex items-center gap-2">
            <UiInput
              v-model="notInSearch"
              placeholder="搜索玩家名 / XUID / 玩家ID"
              class="w-[260px]"
              @keydown.enter="searchNotIn"
            />
            <UiButton variant="outline" size="sm" @click="searchNotIn">
              筛选
            </UiButton>
            <span class="text-sm text-muted-foreground ml-2">
              不在白名单：<span class="font-mono font-bold text-foreground">{{ notInTotal }}</span> 人
            </span>
            <div class="ml-auto flex items-center gap-2">
              <UiButton
                variant="destructive"
                size="sm"
                :disabled="selectedXuids.size === 0 || deleting"
                @click="deleteConfirmOpen = true"
              >
                <TrashIcon class="size-4 mr-1" />
                删除所选 ({{ selectedXuids.size }})
              </UiButton>
            </div>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto rounded-md border">
            <table class="w-full text-sm">
              <thead class="sticky top-0 bg-muted/50">
                <tr>
                  <th class="w-10 px-3 py-2">
                    <UiCheckbox
                      :model-value="currentPageSelectedAll || (currentPageSelectedSome ? 'indeterminate' : false)"
                      @update:model-value="toggleSelectAll"
                    />
                  </th>
                  <th class="text-left font-medium px-3 py-2">
                    玩家名
                  </th>
                  <th class="text-left font-medium px-3 py-2">
                    玩家ID
                  </th>
                  <th class="text-left font-medium px-3 py-2">
                    余额
                  </th>
                  <th class="text-left font-medium px-3 py-2">
                    游戏时长
                  </th>
                  <th class="text-left font-medium px-3 py-2">
                    上次登录
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in notInPlayers" :key="p.xuid" class="border-t">
                  <td class="px-3 py-1.5">
                    <UiCheckbox
                      :model-value="selectedXuids.has(p.xuid)"
                      @update:model-value="toggleSelect(p.xuid)"
                    />
                  </td>
                  <td class="px-3 py-1.5 font-medium">
                    {{ p.name }}
                  </td>
                  <td class="px-3 py-1.5 font-mono text-xs">
                    {{ p.uid }}
                  </td>
                  <td class="px-3 py-1.5 font-mono text-xs">
                    {{ p.balance.toLocaleString() }}
                  </td>
                  <td class="px-3 py-1.5 font-mono text-xs">
                    {{ formatDuration(p.playTime) }}
                  </td>
                  <td class="px-3 py-1.5 text-xs">
                    {{ formatDateTime(p.lastLogin) }}
                  </td>
                </tr>
                <tr v-if="!notInLoading && notInPlayers.length === 0">
                  <td colspan="6" class="px-3 py-10 text-center text-sm text-muted-foreground">
                    没有不在白名单中的玩家
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex items-center justify-between text-sm">
            <div class="text-xs text-muted-foreground">
              第 {{ notInPage }} / {{ notInPages }} 页
            </div>
            <div class="flex items-center gap-2">
              <UiButton variant="outline" size="sm" :disabled="notInPage <= 1" @click="prevPage">
                上一页
              </UiButton>
              <UiButton variant="outline" size="sm" :disabled="notInPage >= notInPages" @click="nextPage">
                下一页
              </UiButton>
            </div>
          </div>

          <div v-if="deleting" class="space-y-1.5">
            <div class="flex items-center justify-between text-xs text-muted-foreground">
              <span>正在删除玩家数据...</span>
              <span class="font-mono">{{ deleteProgress }} / {{ selectedXuids.size }}</span>
            </div>
            <UiProgress :model-value="selectedXuids.size > 0 ? Math.round(deleteProgress / selectedXuids.size * 100) : 0" />
          </div>

          <div v-if="deleteDone" class="rounded-md border p-4 flex items-center gap-3">
            <CheckCircle2Icon class="size-6 text-green-500" />
            <div class="text-sm">
              <p class="font-medium">
                删除完成
              </p>
              <p class="text-muted-foreground">
                成功 <span class="font-mono">{{ deleteResult?.success ?? 0 }}</span> 人，失败
                <span class="font-mono">{{ deleteResult?.fail ?? 0 }}</span> 人
              </p>
            </div>
          </div>
        </UiTabsContent>
      </UiTabs>

      <UiDialogFooter>
        <UiButton variant="outline" @click="open = false">
          关闭
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>

    <!-- 删除确认框 -->
    <UiDialog v-model:open="deleteConfirmOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle class="flex items-center gap-2">
            <TrashIcon class="size-5 text-destructive" />
            确认删除玩家数据
          </UiDialogTitle>
          <UiDialogDescription>
            将从数据库中永久删除所选 {{ selectedXuids.size }} 名不在白名单玩家的全部数据，且不可恢复
          </UiDialogDescription>
        </UiDialogHeader>
        <div class="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-sm text-muted-foreground">
          此操作将删除玩家核心数据、余额、家园、好友、背包快照等所有数据
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="deleteConfirmOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" @click="confirmDelete">
            确认删除
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>
  </UiDialog>
</template>
