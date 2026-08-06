<script setup lang="ts">
import { BanIcon, SearchIcon, TrashIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IPlayer } from '@/services/api/player.api'

import { DataTable, useGenerateVueTable } from '@/components/data-table'
import { BasicPage } from '@/components/global-layout'
import { useBanApi } from '@/services/api/ban.api'
import { useDangerApi } from '@/services/api/danger.api'
import { usePlayerApi } from '@/services/api/player.api'

import { columns } from './all/columns'
import PlayerDetailDialog from './all/player-detail-dialog.vue'
import PlayerInventoryDialog from './all/player-inventory-dialog.vue'
import PlayerMoneyDialog from './all/player-money-dialog.vue'
import PlayerTitleDialog from './all/player-title-dialog.vue'

const { getPlayers, getPlayersRankUid, getPlayersRankPlaytime, getPlayersRankBalance, getPlayerDetail, getOnlinePlayers } = usePlayerApi()
const { getBanList, banPlayer, unbanPlayer } = useBanApi()
const { getDeleteCaptcha, deletePlayerData } = useDangerApi()

const allPlayers = ref<IPlayer[]>([])
const players = ref<IPlayer[]>([])
const loading = ref(true)
const searchQuery = ref('')
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const sortField = ref<string>('uid')
const sortOrder = ref<'asc' | 'desc'>('asc')
const onlinePlayerXuids = ref<Set<string>>(new Set())
const filterBanned = ref(false)

const selectedPlayer = ref<IPlayer | null>(null)
const moneyDialogOpen = ref(false)
const detailDialogOpen = ref(false)
const inventoryDialogOpen = ref(false)
const inventoryDialogRef = ref<{ fetchInventory: () => void } | null>(null)
const banDialogOpen = ref(false)
const banReason = ref('')
const banLoading = ref(false)
const banError = ref('')
const banResult = ref('')
const titleDialogOpen = ref(false)
const unbanDialogOpen = ref(false)
const unbanLoading = ref(false)
const unbanError = ref('')
const unbanResult = ref('')

// 删除数据相关
const deleteDataStep = ref<'confirm' | 'captcha' | 'result'>('confirm')
const deleteDataDialogOpen = ref(false)
const deleteDataLoading = ref(false)
const deleteDataError = ref('')
const deleteDataResult = ref('')
const deleteCaptchaId = ref('')
const deleteCaptchaSvg = ref('')
const deleteCaptchaCode = ref('')
const deleteCaptchaLoading = ref(false)

async function supplementPlayerDetails() {
  const needSupplement = allPlayers.value.filter(p => !p.lastIp && !p.platform && p.xuid)
  if (needSupplement.length === 0)
    return
  const promises = needSupplement.map(async (player) => {
    try {
      const res = await getPlayerDetail(player.xuid)
      if (res.code === 200) {
        if (res.data.lastIp)
          player.lastIp = res.data.lastIp
        if (res.data.platform)
          player.platform = res.data.platform
      }
    }
    catch {}
  })
  await Promise.all(promises)
}

async function fetchOnlinePlayers() {
  try {
    const res = await getOnlinePlayers()
    if (res.code === 200) {
      onlinePlayerXuids.value = new Set(res.data.players.map(p => p.xuid))
    }
  }
  catch {}
}

function updateOnlineStatus() {
  for (const player of allPlayers.value) {
    player.isOnline = onlinePlayerXuids.value.has(player.xuid)
  }
}

async function fetchPlayers() {
  loading.value = true
  try {
    await fetchOnlinePlayers()
    if (sortField.value === 'uid') {
      const res = await getPlayersRankUid({
        page: currentPage.value,
        pageSize: pageSize.value,
        order: sortOrder.value,
      })
      if (res.code === 200) {
        allPlayers.value = res.data.players
        total.value = res.data.pagination.total
        await supplementPlayerDetails()
        updateOnlineStatus()
      }
    }
    else if (sortField.value === 'playTime') {
      const res = await getPlayersRankPlaytime({
        page: currentPage.value,
        pageSize: pageSize.value,
        order: sortOrder.value,
      })
      if (res.code === 200) {
        allPlayers.value = res.data.players
        total.value = res.data.pagination.total
        await supplementPlayerDetails()
        updateOnlineStatus()
      }
    }
    else if (sortField.value === 'balance') {
      const res = await getPlayersRankBalance({
        page: currentPage.value,
        pageSize: pageSize.value,
        order: sortOrder.value,
      })
      if (res.code === 200) {
        allPlayers.value = res.data.players
        total.value = res.data.pagination.total
        await supplementPlayerDetails()
        updateOnlineStatus()
      }
    }
    else {
      const res = await getPlayers({
        page: currentPage.value,
        pageSize: pageSize.value,
        search: searchQuery.value || undefined,
      })
      if (res.code === 200) {
        allPlayers.value = res.data.players
        total.value = res.data.pagination.total
        updateOnlineStatus()
      }
    }
  }
  catch {
  }
  finally {
    loading.value = false
    applyBannedFilter()
  }
}

function applyBannedFilter() {
  // 过滤逻辑现在由 fetchBanList / fetchPlayers 负责，这里仅做兜底
  if (!filterBanned.value) {
    players.value = [...allPlayers.value]
  }
}

async function fetchBanList() {
  loading.value = true
  try {
    const res = await getBanList()
    if (res.code === 200) {
      const banItems = res.data || []
      // 将封禁列表项映射为 IPlayer 兼容结构，补齐表格渲染所需字段
      allPlayers.value = banItems.map((item): IPlayer => {
        return {
          uid: item.uid || 0,
          name: item.name || '',
          xuid: item.xuid,
          registerTime: item.time || '',
          balance: 0,
          isOnline: false,
          isBanned: { banned: true, reason: item.reason, entry: item },
          playTime: 0,
          vipExpire: null,
          lastIp: item.ip || '',
          platform: '',
        }
      })
      total.value = allPlayers.value.length
    }
    else {
      toast.error(res.msg || '获取封禁列表失败')
      allPlayers.value = []
      total.value = 0
    }
  }
  catch {
    toast.error('获取封禁列表失败')
    allPlayers.value = []
    total.value = 0
  }
  finally {
    players.value = [...allPlayers.value]
    loading.value = false
  }
}

async function toggleBannedFilter() {
  filterBanned.value = !filterBanned.value
  if (filterBanned.value) {
    await fetchBanList()
  }
  else {
    await fetchPlayers()
  }
}

function handlePageChange(page: number) {
  if (filterBanned.value)
    return
  currentPage.value = page
  fetchPlayers()
}

function handlePageSizeChange(size: number) {
  if (filterBanned.value)
    return
  pageSize.value = size
  currentPage.value = 1
  fetchPlayers()
}

function handleSearch() {
  currentPage.value = 1
  sortField.value = ''
  // 搜索时退出"仅封禁"模式
  if (filterBanned.value) {
    filterBanned.value = false
  }
  fetchPlayers()
}

function handleSortingChange(field: string, order: 'asc' | 'desc') {
  if (filterBanned.value)
    return
  sortField.value = field
  sortOrder.value = order
  currentPage.value = 1
  fetchPlayers()
}

function openMoneyDialog(player: IPlayer) {
  selectedPlayer.value = player
  moneyDialogOpen.value = true
}

function openDetailDialog(player: IPlayer) {
  selectedPlayer.value = player
  detailDialogOpen.value = true
}

function openInventoryDialog(player: IPlayer) {
  selectedPlayer.value = player
  inventoryDialogOpen.value = true
  nextTick(() => inventoryDialogRef.value?.fetchInventory())
}

function handleMoneySuccess() {
  moneyDialogOpen.value = false
  if (filterBanned.value) {
    fetchBanList()
  }
  else {
    fetchPlayers()
  }
}

function handleDetailClose() {
  detailDialogOpen.value = false
}

function openBanDialog(player: IPlayer) {
  selectedPlayer.value = player
  banReason.value = ''
  banError.value = ''
  banResult.value = ''
  banDialogOpen.value = true
}

function openTitleDialog(player: IPlayer) {
  selectedPlayer.value = player
  titleDialogOpen.value = true
}

function openUnbanDialog(player: IPlayer) {
  selectedPlayer.value = player
  unbanError.value = ''
  unbanResult.value = ''
  unbanDialogOpen.value = true
}

async function handleUnban() {
  if (!selectedPlayer.value)
    return
  unbanLoading.value = true
  unbanError.value = ''
  try {
    const res = await unbanPlayer(selectedPlayer.value.xuid)
    if (res.code === 200) {
      unbanResult.value = `已解封玩家 ${res.data.name}`
      toast.success(`已解封玩家 ${res.data.name}`)
      selectedPlayer.value.isBanned = { banned: false }
      // 在"仅封禁"模式下重新拉取封禁名单，否则刷新当前页
      if (filterBanned.value) {
        await fetchBanList()
      }
      else {
        applyBannedFilter()
      }
    }
    else {
      unbanError.value = res.msg || '解封失败'
      toast.error(res.msg || '解封失败')
    }
  }
  catch {
    unbanError.value = '网络错误'
    toast.error('网络错误')
  }
  finally {
    unbanLoading.value = false
  }
}

async function handleBan() {
  if (!selectedPlayer.value)
    return
  banLoading.value = true
  banError.value = ''
  try {
    const res = await banPlayer(selectedPlayer.value.xuid, banReason.value.trim() || undefined)
    if (res.code === 200) {
      banResult.value = `已封禁玩家 ${res.data.name}`
      toast.success(`已封禁玩家 ${res.data.name}`)
      selectedPlayer.value.isBanned = { banned: true, reason: banReason.value.trim() || undefined }
      // 在"仅封禁"模式下重新拉取封禁名单，否则刷新当前页
      if (filterBanned.value) {
        await fetchBanList()
      }
      else {
        applyBannedFilter()
      }
    }
    else {
      banError.value = res.msg || '封禁失败'
      toast.error(res.msg || '封禁失败')
    }
  }
  catch {
    banError.value = '网络错误'
    toast.error('网络错误')
  }
  finally {
    banLoading.value = false
  }
}

const serverPagination = computed(() => {
  // "仅封禁"模式下一次性拉取全部封禁名单，关闭服务端分页
  if (filterBanned.value) {
    return undefined
  }
  return {
    page: currentPage.value,
    pageSize: pageSize.value,
    total: total.value,
    onPageChange: handlePageChange,
    onPageSizeChange: handlePageSizeChange,
    onSortingChange: handleSortingChange,
  }
})

const tableProps = reactive({
  columns,
  data: players,
  serverPagination,
})

const table = useGenerateVueTable<IPlayer>(tableProps)

provide('openMoneyDialog', openMoneyDialog)
provide('openDetailDialog', openDetailDialog)
provide('openInventoryDialog', openInventoryDialog)
provide('openBanDialog', openBanDialog)
provide('openUnbanDialog', openUnbanDialog)
provide('openTitleDialog', openTitleDialog)
provide('openDeleteDataDialog', openDeleteDataDialog)

onMounted(() => {
  fetchPlayers()
})

// 删除数据功能
function openDeleteDataDialog(player: IPlayer) {
  selectedPlayer.value = player
  deleteDataStep.value = 'confirm'
  deleteDataError.value = ''
  deleteDataResult.value = ''
  deleteCaptchaId.value = ''
  deleteCaptchaSvg.value = ''
  deleteCaptchaCode.value = ''
  deleteDataDialogOpen.value = true
}

async function confirmDeleteData() {
  deleteDataStep.value = 'captcha'
  deleteCaptchaLoading.value = true
  deleteDataError.value = ''
  try {
    const res = await getDeleteCaptcha()
    if (res.code === 200) {
      deleteCaptchaId.value = res.data.captchaId
      deleteCaptchaSvg.value = res.data.svg
    }
    else {
      deleteDataError.value = res.msg || '获取验证码失败'
      deleteDataStep.value = 'confirm'
    }
  }
  catch {
    deleteDataError.value = '获取验证码失败'
    deleteDataStep.value = 'confirm'
  }
  finally {
    deleteCaptchaLoading.value = false
  }
}

function refreshDeleteCaptcha() {
  deleteCaptchaCode.value = ''
  nextTick(() => {
    confirmDeleteData()
  })
}

async function handleDeleteData() {
  if (!selectedPlayer.value)
    return
  if (!deleteCaptchaCode.value.trim()) {
    deleteDataError.value = '请输入验证码'
    return
  }
  deleteDataLoading.value = true
  deleteDataError.value = ''
  try {
    const res = await deletePlayerData({
      xuid: selectedPlayer.value.xuid,
      captchaId: deleteCaptchaId.value,
      captchaCode: deleteCaptchaCode.value.trim(),
    })
    if (res.code === 200) {
      deleteDataResult.value = res.msg || '玩家数据已删除'
      deleteDataStep.value = 'result'
      toast.success(res.msg || '玩家数据已删除')
      if (filterBanned.value) {
        fetchBanList()
      }
      else {
        fetchPlayers()
      }
    }
    else {
      deleteDataError.value = res.msg || '删除失败'
      // 验证码错误时清空输入框并刷新验证码
      deleteCaptchaCode.value = ''
      refreshDeleteCaptcha()
    }
  }
  catch {
    deleteDataError.value = '网络错误'
    deleteCaptchaCode.value = ''
    refreshDeleteCaptcha()
  }
  finally {
    deleteDataLoading.value = false
  }
}
</script>

<template>
  <BasicPage title="所有玩家" description="查看所有已注册的玩家" sticky>
    <template #actions>
      <div class="flex items-center gap-2">
        <UiInput
          v-model="searchQuery"
          placeholder="搜索 UID / 玩家名 / XUID"
          class="w-[250px]"
          @keydown.enter="handleSearch"
        />
        <UiButton variant="outline" size="icon" @click="handleSearch">
          <SearchIcon class="size-4" />
        </UiButton>
        <UiButton
          :variant="filterBanned ? 'destructive' : 'outline'"
          size="sm"
          @click="toggleBannedFilter"
        >
          <BanIcon class="size-4 mr-1" />
          {{ filterBanned ? '显示全部' : '仅封禁' }}
        </UiButton>
      </div>
    </template>
    <div class="overflow-x-auto">
      <DataTable :loading :data="players" :columns :table :server-pagination="serverPagination" />
    </div>

    <PlayerMoneyDialog
      v-if="selectedPlayer"
      v-model:open="moneyDialogOpen"
      :player="selectedPlayer"
      @success="handleMoneySuccess"
    />
    <PlayerDetailDialog
      v-if="selectedPlayer"
      v-model:open="detailDialogOpen"
      :player="selectedPlayer"
      @close="handleDetailClose"
    />
    <PlayerInventoryDialog
      v-if="selectedPlayer"
      ref="inventoryDialogRef"
      v-model:open="inventoryDialogOpen"
      :player="selectedPlayer"
      :show-refresh="false"
    />
    <PlayerTitleDialog
      v-if="selectedPlayer"
      v-model:open="titleDialogOpen"
      :player="selectedPlayer"
    />

    <UiDialog v-model:open="banDialogOpen" @update:open="(v: boolean) => { if (!v) { banResult = ''; banError = ''; banReason = '' } }">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>封禁玩家</UiDialogTitle>
          <UiDialogDescription>
            将 {{ selectedPlayer?.name }} 加入服务器黑名单
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!banResult" class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">封禁原因（可选）</label>
            <UiInput v-model="banReason" placeholder="请输入封禁原因" />
          </div>
          <div v-if="banError" class="text-sm text-destructive">
            {{ banError }}
          </div>
        </div>
        <div v-else class="py-4">
          <div class="rounded-md bg-muted p-3 text-sm">
            {{ banResult }}
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="banDialogOpen = false">
            {{ banResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!banResult" variant="destructive" :disabled="banLoading" @click="handleBan">
            {{ banLoading ? '处理中...' : '确认封禁' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="unbanDialogOpen" @update:open="(v: boolean) => { if (!v) { unbanResult = ''; unbanError = '' } }">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>解封玩家</UiDialogTitle>
          <UiDialogDescription>
            确定要将 {{ selectedPlayer?.name }} 从封禁列表中移除吗？
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!unbanResult" class="space-y-4 py-4">
          <div v-if="unbanError" class="text-sm text-destructive">
            {{ unbanError }}
          </div>
        </div>
        <div v-else class="py-4">
          <div class="rounded-md bg-muted p-3 text-sm">
            {{ unbanResult }}
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="unbanDialogOpen = false">
            {{ unbanResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!unbanResult" :disabled="unbanLoading" @click="handleUnban">
            {{ unbanLoading ? '处理中...' : '确认解封' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <!-- 删除数据对话框 -->
    <UiDialog v-model:open="deleteDataDialogOpen" @update:open="(v: boolean) => { if (!v) { deleteDataResult = ''; deleteDataError = '' } }">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle class="flex items-center gap-2">
            <TrashIcon class="size-5 text-destructive" />
            删除玩家数据
          </UiDialogTitle>
          <UiDialogDescription>
            此操作将删除 {{ selectedPlayer?.name }} 的所有数据
          </UiDialogDescription>
        </UiDialogHeader>

        <!-- 步骤1：确认 -->
        <div v-if="deleteDataStep === 'confirm'" class="space-y-4 py-4">
          <div class="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
            <h4 class="font-medium text-destructive mb-2">
              ⚠️ 危险操作
            </h4>
            <p class="text-sm text-muted-foreground">
              此操作将永久删除以下数据，且不可恢复：
            </p>
            <ul class="text-sm text-muted-foreground mt-2 list-disc list-inside">
              <li>玩家核心数据</li>
              <li>玩家设置</li>
              <li>死亡点记录</li>
              <li>好友列表</li>
              <li>私信记录</li>
              <li>家园数据</li>
              <li>背包快照</li>
            </ul>
          </div>
          <div v-if="deleteDataError" class="text-sm text-destructive">
            {{ deleteDataError }}
          </div>
        </div>

        <!-- 步骤2：验证码 -->
        <div v-else-if="deleteDataStep === 'captcha'" class="space-y-4 py-4">
          <div class="text-sm text-muted-foreground">
            请输入验证码以确认删除操作：
          </div>
          <div v-if="deleteCaptchaLoading" class="flex items-center justify-center py-4">
            <UiSpinner class="size-5" />
          </div>
          <template v-else>
            <div
              class="border rounded-md p-2 bg-muted cursor-pointer flex items-center justify-center"
              @click="refreshDeleteCaptcha"
            >
              <div v-html="deleteCaptchaSvg" />
            </div>
            <p class="text-xs text-muted-foreground text-center">
              点击图片刷新验证码
            </p>
            <UiInput
              v-model="deleteCaptchaCode"
              placeholder="请输入验证码"
              class="text-center text-lg tracking-widest"
              maxlength="4"
            />
          </template>
          <div v-if="deleteDataError" class="text-sm text-destructive">
            {{ deleteDataError }}
          </div>
        </div>

        <!-- 步骤3：结果 -->
        <div v-else-if="deleteDataStep === 'result'" class="py-4">
          <div class="rounded-md bg-muted p-3 text-sm">
            {{ deleteDataResult }}
          </div>
        </div>

        <UiDialogFooter>
          <UiButton variant="outline" @click="deleteDataDialogOpen = false">
            {{ deleteDataStep === 'result' ? '关闭' : '取消' }}
          </UiButton>
          <UiButton
            v-if="deleteDataStep === 'confirm'"
            variant="destructive"
            @click="confirmDeleteData"
          >
            继续
          </UiButton>
          <UiButton
            v-if="deleteDataStep === 'captcha'"
            variant="destructive"
            :disabled="deleteDataLoading || !deleteCaptchaCode.trim()"
            @click="handleDeleteData"
          >
            {{ deleteDataLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>
  </BasicPage>
</template>
