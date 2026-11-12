<script setup lang="ts">
import type { ColumnDef } from '@tanstack/vue-table'

import { MoreHorizontalIcon, ZapIcon } from '@lucide/vue'
import { h } from 'vue'
import { toast } from 'vue-sonner'

import type { IOnlinePlayer, IPlayer } from '@/services/api/player.api'

import { DataTable, useGenerateVueTable } from '@/components/data-table'
import { BasicPage } from '@/components/global-layout'
import UiButton from '@/components/ui/button/Button.vue'
import UiDropdownMenu from '@/components/ui/dropdown-menu/DropdownMenu.vue'
import UiDropdownMenuContent from '@/components/ui/dropdown-menu/DropdownMenuContent.vue'
import UiDropdownMenuItem from '@/components/ui/dropdown-menu/DropdownMenuItem.vue'
import UiDropdownMenuSeparator from '@/components/ui/dropdown-menu/DropdownMenuSeparator.vue'
import UiDropdownMenuTrigger from '@/components/ui/dropdown-menu/DropdownMenuTrigger.vue'
import PlayerDetailDialog from '@/pages/players/all/player-detail-dialog.vue'
import PlayerHeatmapDialog from '@/pages/players/all/player-heatmap-dialog.vue'
import PlayerInventoryDialog from '@/pages/players/all/player-inventory-dialog.vue'
import PlayerTitleDialog from '@/pages/players/all/player-title-dialog.vue'
import { useBanApi } from '@/services/api/ban.api'
import { usePlayerApi } from '@/services/api/player.api'

const { getOnlinePlayers, changeGameMode, kickPlayer, crashPlayer, sendPopup, moneyOperation, lightningPlayer } = usePlayerApi()
const { banPlayer } = useBanApi()

const players = ref<IOnlinePlayer[]>([])
const loading = ref(true)
const onlineCount = ref(0)

const gameModeNumberMap: Record<number, string> = {
  0: '生存',
  1: '创造',
  2: '冒险',
  3: '旁观',
}

const dimensionMap: Record<number, string> = {
  0: '主世界',
  1: '下界',
  2: '末地',
}

async function fetchOnline() {
  loading.value = true
  try {
    const res = await getOnlinePlayers()
    if (res.code === 200) {
      players.value = res.data.players
      onlineCount.value = res.data.count
      toast.success(`已刷新在线玩家列表 (共 ${onlineCount.value} 人)`)
    }
  }
  catch {
    toast.error('刷新在线玩家失败')
  }
  finally {
    loading.value = false
  }
}

const gamemodeDialogOpen = ref(false)
const moneyDialogOpen = ref(false)
const popupDialogOpen = ref(false)
const kickDialogOpen = ref(false)
const crashDialogOpen = ref(false)
const banDialogOpen = ref(false)
const lightningDialogOpen = ref(false)
const inventoryDialogOpen = ref(false)
const titleDialogOpen = ref(false)
const detailDialogOpen = ref(false)
const heatmapDialogOpen = ref(false)
const selectedPlayer = ref<IOnlinePlayer | null>(null)
const inventoryDialogRef = ref<{ fetchInventory: () => void } | null>(null)
const actionLoading = ref(false)
const actionResult = ref('')
const actionError = ref('')

// 将 IOnlinePlayer 转换为 IPlayer 以适配 PlayerInventoryDialog
function onlinePlayerToIPlayer(p: IOnlinePlayer): IPlayer {
  return {
    uid: 0,
    name: p.name,
    xuid: p.xuid,
    registerTime: '',
    balance: p.balance,
    isOnline: true,
    isBanned: { banned: false },
    playTime: 0,
    vipExpire: null,
    lastIp: p.ip,
    platform: p.platform || p.os || '',
  }
}

function openActionDialog(player: IOnlinePlayer, type: 'gamemode' | 'money' | 'popup' | 'kick' | 'crash' | 'ban' | 'lightning' | 'inventory' | 'title' | 'detail' | 'heatmap') {
  selectedPlayer.value = player
  actionResult.value = ''
  actionError.value = ''
  if (type === 'gamemode') {
    gamemodeDialogOpen.value = true
  }
  else if (type === 'money') {
    moneyDialogOpen.value = true
  }
  else if (type === 'popup') {
    popupDialogOpen.value = true
  }
  else if (type === 'kick') {
    kickDialogOpen.value = true
  }
  else if (type === 'crash') {
    crashDialogOpen.value = true
  }
  else if (type === 'ban') {
    banDialogOpen.value = true
  }
  else if (type === 'lightning') {
    lightningDialogOpen.value = true
  }
  else if (type === 'inventory') {
    inventoryDialogOpen.value = true
    nextTick(() => inventoryDialogRef.value?.fetchInventory())
  }
  else if (type === 'title') {
    titleDialogOpen.value = true
  }
  else if (type === 'detail') {
    detailDialogOpen.value = true
  }
  else if (type === 'heatmap') {
    heatmapDialogOpen.value = true
  }
}

const selectedGameMode = ref<string>('survival')
const moneyAction = ref<'add' | 'reduce' | 'set'>('add')
const moneyAmount = ref<number | undefined>(undefined)
const popupContent = ref('')
const kickReason = ref('')
const banReason = ref('')

async function handleChangeGameMode() {
  if (!selectedPlayer.value)
    return
  actionLoading.value = true
  actionError.value = ''
  try {
    const res = await changeGameMode(selectedPlayer.value.xuid, selectedGameMode.value)
    if (res.code === 200) {
      actionResult.value = `已将 ${res.data.name} 的游戏模式从 ${res.data.oldModeName} 改为 ${res.data.newModeName}`
      toast.success(`已将 ${res.data.name} 的游戏模式改为 ${res.data.newModeName}`)
      fetchOnline()
    }
    else {
      actionError.value = res.msg || '操作失败'
      toast.error(res.msg || '修改游戏模式失败')
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

async function handleMoneyOperation() {
  if (!selectedPlayer.value || !moneyAmount.value || moneyAmount.value <= 0) {
    actionError.value = '请输入有效的金额'
    return
  }
  actionLoading.value = true
  actionError.value = ''
  try {
    const res = await moneyOperation(selectedPlayer.value.xuid, moneyAction.value, moneyAmount.value)
    if (res.code === 200) {
      actionResult.value = `${res.data.name} 余额: ${res.data.before.toLocaleString()} → ${res.data.after.toLocaleString()}`
      toast.success(`${res.data.name} 余额已更新: ${res.data.after.toLocaleString()}`)
      fetchOnline()
    }
    else {
      actionError.value = res.msg || '操作失败'
      toast.error(res.msg || '经济操作失败')
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

async function handleSendPopup() {
  if (!selectedPlayer.value || !popupContent.value.trim()) {
    actionError.value = '请输入消息内容'
    return
  }
  actionLoading.value = true
  actionError.value = ''
  try {
    const res = await sendPopup(selectedPlayer.value.xuid, popupContent.value.trim())
    if (res.code === 200) {
      actionResult.value = `已向 ${selectedPlayer.value.name} 发送消息`
      toast.success(`已向 ${selectedPlayer.value.name} 发送消息`)
      popupContent.value = ''
    }
    else {
      actionError.value = res.msg || '操作失败'
      toast.error(res.msg || '发送消息失败')
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

async function handleKick() {
  if (!selectedPlayer.value)
    return
  actionLoading.value = true
  actionError.value = ''
  try {
    const res = await kickPlayer(selectedPlayer.value.xuid, kickReason.value.trim() || undefined)
    if (res.code === 200) {
      actionResult.value = `已将 ${selectedPlayer.value.name} 踢出游戏`
      toast.success(`已将 ${selectedPlayer.value.name} 踢出游戏`)
      kickReason.value = ''
      fetchOnline()
    }
    else {
      actionError.value = res.msg || '操作失败'
      toast.error(res.msg || '踢出玩家失败')
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

async function handleCrash() {
  if (!selectedPlayer.value)
    return
  actionLoading.value = true
  actionError.value = ''
  const playerName = selectedPlayer.value.name
  try {
    const res = await crashPlayer(selectedPlayer.value.xuid)
    if (res.code === 200) {
      actionResult.value = `已执行崩溃 ${playerName} 客户端`
      toast.success(`已执行崩溃 ${playerName} 客户端`)
      fetchOnline()
    }
    else {
      actionError.value = res.msg || '操作失败'
      toast.error(res.msg || '崩溃客户端失败')
    }
  }
  catch (error: any) {
    const body = error?.data
    if (body?.code === 200) {
      actionResult.value = `已执行崩溃 ${playerName} 客户端`
      toast.success(`已执行崩溃 ${playerName} 客户端`)
      fetchOnline()
    }
    else {
      actionError.value = body?.msg || '网络错误'
      toast.error(body?.msg || '网络错误')
    }
  }
  finally {
    actionLoading.value = false
  }
}

async function handleBan() {
  if (!selectedPlayer.value)
    return
  actionLoading.value = true
  actionError.value = ''
  try {
    const res = await banPlayer(selectedPlayer.value.xuid, banReason.value.trim() || undefined)
    if (res.code === 200) {
      actionResult.value = `已封禁玩家 ${res.data.name}`
      toast.success(`已封禁玩家 ${res.data.name}`)
      banReason.value = ''
      fetchOnline()
    }
    else {
      actionError.value = res.msg || '操作失败'
      toast.error(res.msg || '封禁失败')
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

async function handleLightning() {
  if (!selectedPlayer.value)
    return
  actionLoading.value = true
  actionError.value = ''
  try {
    const res = await lightningPlayer(selectedPlayer.value.name)
    if (res.code === 200) {
      actionResult.value = res.msg
      toast.success(res.msg)
    }
    else {
      actionError.value = res.msg || '操作失败'
      toast.error(res.msg || '雷劈失败')
    }
  }
  catch (error: any) {
    const msg = error?.data?.msg || '网络错误'
    actionError.value = msg
    toast.error(msg)
  }
  finally {
    actionLoading.value = false
  }
}

function resetDialogState() {
  selectedGameMode.value = 'survival'
  moneyAction.value = 'add'
  moneyAmount.value = undefined
  popupContent.value = ''
  kickReason.value = ''
  banReason.value = ''
  actionResult.value = ''
  actionError.value = ''
}

const columns: ColumnDef<IOnlinePlayer>[] = [
  {
    accessorKey: 'name',
    header: () => h('div', { class: 'text-sm font-medium' }, '玩家名'),
    cell: ({ row }) => h('div', { class: 'font-medium' }, row.getValue('name')),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'xuid',
    header: () => h('div', { class: 'text-sm font-medium' }, 'XUID'),
    cell: ({ row }) => h('div', { class: 'font-mono text-xs' }, row.getValue('xuid')),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'balance',
    header: () => h('div', { class: 'text-sm font-medium' }, '余额'),
    cell: ({ row }) => h('div', { class: 'font-mono' }, row.original.balance.toLocaleString()),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'dimension',
    header: () => h('div', { class: 'text-sm font-medium' }, '维度'),
    cell: ({ row }) => h('div', {}, dimensionMap[row.original.dimension] || `未知(${row.original.dimension})`),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'gameMode',
    header: () => h('div', { class: 'text-sm font-medium' }, '游戏模式'),
    cell: ({ row }) => h('div', {}, gameModeNumberMap[row.original.gameMode] || `未知(${row.original.gameMode})`),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'platform',
    header: () => h('div', { class: 'text-sm font-medium' }, '平台'),
    cell: ({ row }) => h('div', {}, row.original.platform || row.original.os || '-'),
    enableSorting: false,
    enableResizing: true,
  },
  {
    accessorKey: 'ping',
    header: () => h('div', { class: 'text-sm font-medium' }, 'Ping'),
    cell: ({ row }) => h('div', { class: 'font-mono' }, `${row.original.ping}ms`),
    enableSorting: false,
    enableResizing: true,
  },
  {
    id: 'actions',
    header: () => h('div', {}, '操作'),
    cell: ({ row }) => {
      return h(UiDropdownMenu, {}, {
        default: () => [
          h(UiDropdownMenuTrigger, { asChild: true }, {
            default: () => h(UiButton, { variant: 'ghost', size: 'icon', class: 'h-8 w-8' }, {
              default: () => h(MoreHorizontalIcon, { class: 'size-4' }),
            }),
          }),
          h(UiDropdownMenuContent, { align: 'end' }, {
            default: () => [
              h(UiDropdownMenuItem, { onClick: () => openActionDialog(row.original, 'detail') }, { default: () => '玩家详情' }),
              h(UiDropdownMenuItem, { onClick: () => openActionDialog(row.original, 'heatmap') }, { default: () => '游戏时长热力图' }),
              h(UiDropdownMenuItem, { onClick: () => openActionDialog(row.original, 'gamemode') }, { default: () => '修改游戏模式' }),
              h(UiDropdownMenuItem, { onClick: () => openActionDialog(row.original, 'money') }, { default: () => '经济管理' }),
              h(UiDropdownMenuItem, { onClick: () => openActionDialog(row.original, 'popup') }, { default: () => '发送消息' }),
              h(UiDropdownMenuItem, { onClick: () => openActionDialog(row.original, 'inventory') }, { default: () => '背包查询' }),
              h(UiDropdownMenuItem, { onClick: () => openActionDialog(row.original, 'title') }, { default: () => '称号管理' }),
              h(UiDropdownMenuSeparator),
              ...(row.original.gameMode !== 1
                ? [h(UiDropdownMenuItem, { class: 'text-destructive', onClick: () => openActionDialog(row.original, 'lightning') }, { default: () => '雷劈致死' })]
                : []),
              h(UiDropdownMenuItem, { class: 'text-destructive', onClick: () => openActionDialog(row.original, 'crash') }, { default: () => '崩溃客户端' }),
              h(UiDropdownMenuItem, { class: 'text-destructive', onClick: () => openActionDialog(row.original, 'ban') }, { default: () => '封禁' }),
              h(UiDropdownMenuItem, { class: 'text-destructive', onClick: () => openActionDialog(row.original, 'kick') }, { default: () => '踢出游戏' }),
            ],
          }),
        ],
      })
    },
    enableSorting: false,
    enablePinning: false,
    enableResizing: false,
  },
]

const tableProps = reactive({
  columns,
  data: players,
})

const table = useGenerateVueTable<IOnlinePlayer>(tableProps)

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  fetchOnline()
  timer = setInterval(fetchOnline, 30000)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<template>
  <BasicPage title="在线玩家" description="查看当前在线的玩家列表" sticky>
    <template #actions>
      <div class="flex items-center gap-3">
        <span class="text-sm text-muted-foreground">
          在线人数: <span class="font-mono font-bold text-foreground">{{ onlineCount }}</span>
        </span>
        <UiButton variant="outline" size="sm" :disabled="loading" @click="fetchOnline">
          刷新
        </UiButton>
      </div>
    </template>

    <div class="overflow-x-auto">
      <DataTable :loading :data="players" :columns :table />
    </div>

    <UiDialog v-model:open="gamemodeDialogOpen" @update:open="(v: boolean) => { if (!v) resetDialogState() }">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>修改游戏模式</UiDialogTitle>
          <UiDialogDescription>
            修改 {{ selectedPlayer?.name }} 的游戏模式
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!actionResult" class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">游戏模式</label>
            <UiSelect v-model="selectedGameMode">
              <UiSelectTrigger>
                <UiSelectValue />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem value="survival">
                  生存
                </UiSelectItem>
                <UiSelectItem value="creative">
                  创造
                </UiSelectItem>
                <UiSelectItem value="adventure">
                  冒险
                </UiSelectItem>
                <UiSelectItem value="spectator">
                  旁观
                </UiSelectItem>
              </UiSelectContent>
            </UiSelect>
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
          <UiButton variant="outline" @click="gamemodeDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleChangeGameMode">
            {{ actionLoading ? '处理中...' : '确认' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="moneyDialogOpen" @update:open="(v: boolean) => { if (!v) resetDialogState() }">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>经济管理</UiDialogTitle>
          <UiDialogDescription>
            对 {{ selectedPlayer?.name }} 进行经济操作，当前余额: {{ selectedPlayer?.balance.toLocaleString() }}
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!actionResult" class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">操作类型</label>
            <UiSelect v-model="moneyAction">
              <UiSelectTrigger>
                <UiSelectValue />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem value="add">
                  增加
                </UiSelectItem>
                <UiSelectItem value="reduce">
                  减少
                </UiSelectItem>
                <UiSelectItem value="set">
                  设置
                </UiSelectItem>
              </UiSelectContent>
            </UiSelect>
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">金额</label>
            <UiInput v-model="moneyAmount" type="number" placeholder="请输入金额" :min="1" />
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
          <UiButton variant="outline" @click="moneyDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleMoneyOperation">
            {{ actionLoading ? '处理中...' : '确认' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="popupDialogOpen" @update:open="(v: boolean) => { if (!v) resetDialogState() }">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>发送消息</UiDialogTitle>
          <UiDialogDescription>
            向 {{ selectedPlayer?.name }} 发送表单消息
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!actionResult" class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">消息内容</label>
            <UiTextarea v-model="popupContent" placeholder="请输入消息内容" :rows="3" />
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
          <UiButton variant="outline" @click="popupDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" :disabled="actionLoading" @click="handleSendPopup">
            {{ actionLoading ? '发送中...' : '发送' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="kickDialogOpen" @update:open="(v: boolean) => { if (!v) resetDialogState() }">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>踢出游戏</UiDialogTitle>
          <UiDialogDescription>
            将 {{ selectedPlayer?.name }} 踢出游戏
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!actionResult" class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">踢出原因（可选）</label>
            <UiInput v-model="kickReason" placeholder="请输入踢出原因" />
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
          <UiButton variant="outline" @click="kickDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" variant="destructive" :disabled="actionLoading" @click="handleKick">
            {{ actionLoading ? '处理中...' : '确认踢出' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="crashDialogOpen" @update:open="(v: boolean) => { if (!v) resetDialogState() }">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>崩溃客户端</UiDialogTitle>
          <UiDialogDescription>
            使 {{ selectedPlayer?.name }} 的客户端崩溃
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!actionResult" class="space-y-4 py-4">
          <p class="text-sm text-muted-foreground">
            确认要使该玩家的客户端崩溃吗？此操作不可撤销。
          </p>
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
          <UiButton variant="outline" @click="crashDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" variant="destructive" :disabled="actionLoading" @click="handleCrash">
            {{ actionLoading ? '处理中...' : '确认崩溃' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="banDialogOpen" @update:open="(v: boolean) => { if (!v) resetDialogState() }">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>封禁玩家</UiDialogTitle>
          <UiDialogDescription>
            将 {{ selectedPlayer?.name }} 加入服务器黑名单
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!actionResult" class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">封禁原因（可选）</label>
            <UiInput v-model="banReason" placeholder="请输入封禁原因" />
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
          <UiButton variant="outline" @click="banDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" variant="destructive" :disabled="actionLoading" @click="handleBan">
            {{ actionLoading ? '处理中...' : '确认封禁' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="lightningDialogOpen" @update:open="(v: boolean) => { if (!v) resetDialogState() }">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle class="flex items-center gap-2">
            <ZapIcon class="size-5 text-destructive" />
            雷劈致死
          </UiDialogTitle>
          <UiDialogDescription>
            对 {{ selectedPlayer?.name }} 持续雷劈，直到死亡或切换创造模式。再次请求可取消雷劈。
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
          <UiButton variant="outline" @click="lightningDialogOpen = false">
            {{ actionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!actionResult" variant="destructive" :disabled="actionLoading" @click="handleLightning">
            <ZapIcon class="size-4 mr-1" />
            {{ actionLoading ? '处理中...' : '确认雷劈' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <PlayerInventoryDialog
      v-if="selectedPlayer"
      ref="inventoryDialogRef"
      v-model:open="inventoryDialogOpen"
      :player="onlinePlayerToIPlayer(selectedPlayer!)"
      :show-refresh="true"
    />
    <PlayerTitleDialog
      v-if="selectedPlayer"
      v-model:open="titleDialogOpen"
      :player="onlinePlayerToIPlayer(selectedPlayer!)"
    />
    <PlayerDetailDialog
      v-if="selectedPlayer"
      v-model:open="detailDialogOpen"
      :player="onlinePlayerToIPlayer(selectedPlayer!)"
      @close="detailDialogOpen = false"
    />
    <PlayerHeatmapDialog
      v-if="selectedPlayer"
      v-model:open="heatmapDialogOpen"
      :player="onlinePlayerToIPlayer(selectedPlayer!)"
    />
  </BasicPage>
</template>
