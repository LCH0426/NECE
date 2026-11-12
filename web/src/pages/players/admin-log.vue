<script setup lang="ts">
import type { ColumnDef } from '@tanstack/vue-table'

import { RefreshCwIcon, SearchIcon } from '@lucide/vue'
import { h } from 'vue'
import { toast } from 'vue-sonner'

import type { ILogEntry } from '@/services/api/player.api'

import { DataTable, useGenerateVueTable } from '@/components/data-table'
import { BasicPage } from '@/components/global-layout'
import { usePlayerApi } from '@/services/api/player.api'

const { getSystemLogs } = usePlayerApi()

const entries = ref<ILogEntry[]>([])
const loading = ref(true)
const currentPage = ref(1)
const pageSize = ref(50)
const total = ref(0)

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const today = new Date()
const defaultEnd = toDateStr(today)
const defaultStart = toDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2))

const startDate = ref(defaultStart)
const endDate = ref(defaultEnd)
const startTime = ref('00:00')
const endTime = ref('23:59')
const selectedLevels = ref<string[]>([])
const selectedEvent = ref('all')
const playerQuery = ref('')
const keyword = ref('')

const LEVELS = [
  { value: 'emerg', label: '系统不可用', class: 'text-red-700 border-red-700/40' },
  { value: 'alert', label: '立即处理', class: 'text-red-600 border-red-600/40' },
  { value: 'crit', label: '临界', class: 'text-red-500 border-red-500/40' },
  { value: 'err', label: '错误', class: 'text-orange-600 border-orange-600/40' },
  { value: 'warn', label: '警告', class: 'text-yellow-600 border-yellow-600/40' },
  { value: 'notice', label: '重要', class: 'text-blue-600 border-blue-600/40' },
  { value: 'info', label: '信息', class: 'text-muted-foreground border-border' },
  { value: 'debug', label: '调试', class: 'text-gray-500 border-gray-400/40' },
]

const EVENT_OPTIONS = [
  { value: 'all', label: '全部事件' },
  { value: 'chat', label: '聊天' },
  { value: 'admin.', label: '管理员操作' },
  { value: 'economy.', label: '经济' },
  { value: 'bank.', label: '银行' },
  { value: 'vip.', label: 'VIP' },
  { value: 'wish.', label: '祈愿' },
  { value: 'mail.', label: '邮件' },
  { value: 'guild.', label: '公会' },
  { value: 'teleport.', label: '传送' },
  { value: 'friend.', label: '好友' },
  { value: 'board.', label: '留言板' },
  { value: 'mapart.', label: '地图画' },
  { value: 'auth.', label: '安全' },
]

const EVENT_MAP: Record<string, string> = {
  'admin.backup_run': '执行备份',
  'admin.backup_delete': '删除备份',
  'admin.download_link_generate': '生成下载链接',
  'admin.backup_config_update': '修改备份配置',
  'admin.structure_file_download': '下载建筑文件',
  'admin.structure_file_delete': '删除建筑文件',
  'admin.structure_file_upload': '上传建筑文件',
  'admin.data_backup': '执行数据备份',
  'admin.ban': '封禁玩家',
  'admin.unban': '解封玩家',
  'admin.title_add': '添加称号',
  'admin.title_set': '设置称号',
  'admin.title_delete': '删除称号',
  'admin.player_data_delete': '删除玩家所有数据',
  'admin.maintenance_enable': '开启维护模式',
  'admin.maintenance_disable': '关闭维护模式',
  'admin.smite': '雷劈致死',
  'admin.wish_banner_update': '修改卡池信息',
  'admin.wish_four_star_add': '添加四星奖励',
  'admin.wish_four_star_update': '修改四星奖励',
  'admin.wish_four_star_delete': '删除四星奖励',
  'admin.wish_five_star_add': '添加五星奖励',
  'admin.wish_five_star_update': '修改五星奖励',
  'admin.wish_five_star_delete': '删除五星奖励',
  'admin.wish_core_add': '添加核心兑换物品',
  'admin.wish_core_update': '修改核心兑换物品',
  'admin.wish_core_delete': '删除核心兑换物品',
  'admin.wish_three_star_update': '修改三星物品配置',
  'admin.wish_rates_update': '修改祈愿概率配置',
  'admin.wish_cost_update': '修改祈愿花费配置',
  'admin.wish_description_update': '修改祈愿系统说明',
  'admin.message_delete': '删除留言',
  'admin.cdk_add': '添加CDK',
  'admin.cdk_delete': '删除CDK',
  'admin.cdk_update': '修改CDK',
  'admin.whitelist_add': '添加白名单',
  'admin.whitelist_delete': '删除白名单',
  'admin.broadcast': '全服广播',
  'admin.guild_delete': '删除公会',
  'admin.guild_update': '修改公会信息',
  'admin.guild_teleport_add': '添加公会传送点',
  'admin.guild_teleport_delete': '删除公会传送点',
  'admin.guild_funds_update': '修改公会资金',
  'admin.mail_send': '发送邮件',
  'admin.mail_delete': '删除邮件',
  'admin.player_data_batch_delete': '批量删除玩家数据',
  'admin.kick': '踢出玩家',
  'admin.economy_operation': '经济操作',
  'admin.popup_send': '发送弹窗',
  'admin.gamemode_update': '修改游戏模式',
  'admin.uid_reassign': '重新分配UID',
  'admin.client_crash': '崩溃玩家客户端',
  'admin.playtime_assign': '随机分配游戏时长',
  'admin.recycle_add': '添加回收物品',
  'admin.recycle_update': '修改回收物品',
  'admin.recycle_delete': '删除回收物品',
  'admin.shop_group_add': '添加商店分组',
  'admin.shop_group_update': '修改商店分组',
  'admin.shop_group_delete': '删除商店分组',
  'admin.shop_item_add': '添加商店物品',
  'admin.shop_item_update': '修改商店物品',
  'admin.shop_item_delete': '删除商店物品',
  'admin.unknown': '未知操作',
  'chat': '聊天',
  'economy.reduce': '经济扣费',
  'economy.add': '经济入账',
  'economy.transfer': '转账',
  'economy.buy': '商店购买',
  'economy.sell': '商店出售',
  'economy.recycle': '物品回收',
  'economy.failed': '经济操作失败',
  'bank.deposit': '活期存入',
  'bank.withdraw': '活期取出',
  'bank.fixed_create': '定期存入',
  'bank.fixed_withdraw': '定期取出',
  'vip.purchase': 'VIP购买',
  'vip.expire': 'VIP到期',
  'wish.core_exchange': '星核兑换',
  'wish.dust_exchange': '星尘兑换',
  'wish.enchant_purchase': '附魔书兑换',
  'wish.spawn_egg_purchase': '刷怪蛋兑换',
  'wish.attribute_upgrade': '属性提升',
  'wish.grant_failed': '祈愿奖励发放失败',
  'mail.send_global': '发送全服邮件',
  'mail.send_single': '发送单封邮件',
  'mail.claim': '领取邮件附件',
  'mail.delete': '删除邮件',
  'mail.scheduled_sent': '定时邮件发送',
  'guild.create': '创建公会',
  'guild.disband': '解散公会',
  'guild.join': '加入公会',
  'guild.leave': '退出公会',
  'guild.kick': '踢出公会成员',
  'guild.role_change': '变更公会职位',
  'guild.transfer': '转让公会',
  'guild.fund_change': '公会资金变动',
  'guild.teleport_add': '添加公会传送点',
  'guild.teleport_delete': '删除公会传送点',
  'friend.request': '好友请求',
  'friend.add': '添加好友',
  'friend.delete': '删除好友',
  'teleport.home_set': '设置家园',
  'teleport.home_delete': '删除家园',
  'teleport.home_share': '共享家园',
  'teleport.warp_add': '添加地标',
  'teleport.warp_delete': '删除地标',
  'board.post': '发布留言',
  'board.delete': '删除留言',
  'mapart.upload': '上传地图画',
  'mapart.delete': '删除地图画',
  'mapart.upload_failed': '地图画上传失败',
  'cdk.redeem': 'CDK兑换',
  'cdk.redeem_failed': 'CDK兑换失败',
  'auth.login_success': '登录成功',
  'auth.login_failed': '登录失败',
  'auth.refresh_replay': 'Token重放检测',
  'auth.admin_denied': '管理员权限拒绝',
  'auth.rate_limited': '请求限流',
}

function text(value: any): string {
  if (value === null || value === undefined || value === '')
    return '-'
  return String(value)
}

function eventLabel(event: string): string {
  return EVENT_MAP[event] || event
}

function subjectOf(entry: ILogEntry): string {
  const fields = ['admin_name', 'admin', 'player', 'sender', 'operator', 'author', 'uid', 'xuid']
  for (const field of fields) {
    if (entry[field] !== undefined && entry[field] !== null && entry[field] !== '')
      return String(entry[field])
  }
  return '-'
}

function summaryOf(entry: ILogEntry): string {
  const fields = ['detail', 'reason', 'message', 'item', 'enchant', 'error', 'guild', 'home', 'warp', 'filename', 'target', 'action']
  for (const field of fields) {
    if (entry[field] !== undefined && entry[field] !== null && entry[field] !== '')
      return String(entry[field])
  }
  return '-'
}

function levelCell(level: string) {
  const meta = LEVELS.find(item => item.value === level) || LEVELS[6]
  return h('span', {
    class: `inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold ${meta.class}`,
  }, meta.label)
}

function textColumn(key: string, header: string, getter?: (entry: ILogEntry) => any, mono = false): ColumnDef<ILogEntry> {
  return {
    id: key,
    header: () => h('div', { class: 'text-sm font-medium' }, header),
    cell: ({ row }) => h('div', {
      class: `text-xs max-w-[260px] truncate ${mono ? 'font-mono whitespace-nowrap' : ''}`,
    }, text(getter ? getter(row.original) : row.original[key])),
    enableSorting: false,
    enableResizing: true,
  }
}

function timeColumn(): ColumnDef<ILogEntry> {
  return textColumn('time', '时间', undefined, true)
}

function levelColumn(): ColumnDef<ILogEntry> {
  return {
    id: 'level',
    header: () => h('div', { class: 'text-sm font-medium' }, '级别'),
    cell: ({ row }) => levelCell(row.original.level),
    enableSorting: false,
    enableResizing: true,
  }
}

function eventColumn(): ColumnDef<ILogEntry> {
  return {
    id: 'event',
    header: () => h('div', { class: 'text-sm font-medium' }, '事件'),
    cell: ({ row }) => h('span', {
      class: 'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold',
    }, eventLabel(row.original.event)),
    enableSorting: false,
    enableResizing: true,
  }
}

function buildColumns(category: string): ColumnDef<ILogEntry>[] {
  const time = timeColumn()
  const level = levelColumn()
  const event = eventColumn()

  switch (category) {
    case 'chat':
      return [time, level, textColumn('sender', '发送者'), textColumn('type', '类型'), textColumn('message', '内容')]
    case 'admin.':
      return [time, level, event, textColumn('admin', '管理员'), textColumn('target', '目标'), textColumn('detail', '详情')]
    case 'economy.':
      return [time, level, event, textColumn('player', '玩家'), textColumn('amount', '金额'), textColumn('balance', '余额'), textColumn('reason', '原因')]
    case 'bank.':
      return [time, level, event, textColumn('player', '玩家'), textColumn('amount', '金额', e => e.amount ?? e.principal), textColumn('balance', '余额'), textColumn('detail', '详情', e => e.detail || e.deposit_id || (e.days ? `${e.days}天` : ''))]
    case 'vip.':
      return [time, level, event, textColumn('player', '玩家'), textColumn('price', '价格'), textColumn('duration', '时长', e => e.permanent ? '永久' : (e.duration_days ? `${e.duration_days}天` : '')), textColumn('expire', '到期', e => e.expire_time || e.total_saved), textColumn('balance', '余额')]
    case 'wish.':
      return [time, level, event, textColumn('player', '玩家'), textColumn('item', '物品', e => e.item || e.enchant || e.reward), textColumn('quantity', '数量', e => e.quantity ?? e.points ?? e.amount), textColumn('cost', '消耗', e => e.cost), textColumn('balance', '余额', e => e.core_balance ?? e.dust_balance)]
    case 'mail.':
      return [time, level, event, textColumn('operator', '操作者', e => e.operator || e.from || e.player), textColumn('target', '目标', e => e.target || e.to || e.target_xuid), textColumn('mail_id', '邮件ID'), textColumn('detail', '详情', e => e.detail || e.error || (e.has_attachment ? '含附件' : '') || e.money)]
    case 'guild.':
      return [time, level, event, textColumn('player', '玩家'), textColumn('target', '目标', e => e.target || e.target_xuid), textColumn('guild', '公会'), textColumn('amount', '金额'), textColumn('source', '来源')]
    case 'teleport.':
      return [time, level, event, textColumn('player', '玩家'), textColumn('name', '名称', e => e.home || e.warp), textColumn('position', '坐标', e => (e.dim !== undefined ? `D${e.dim} ${e.x ?? ''},${e.y ?? ''},${e.z ?? ''}` : '')), textColumn('target', '目标')]
    case 'friend.':
      return [time, level, event, textColumn('player', '玩家'), textColumn('target', '目标'), textColumn('action', '动作')]
    case 'board.':
      return [time, level, event, textColumn('player', '玩家', e => e.player || e.author), textColumn('message_id', '留言ID'), textColumn('content_length', '字数')]
    case 'mapart.':
      return [time, level, event, textColumn('uid', 'UID'), textColumn('filename', '文件名', e => e.filename || e.original_name), textColumn('size', '大小', e => e.size ? `${Math.round(e.size / 1024)} KB` : ''), textColumn('error', '错误')]
    case 'auth.':
      return [time, level, event, textColumn('uid', 'UID'), textColumn('ip', 'IP'), textColumn('reason', '原因'), textColumn('detail', '详情', e => e.path || e.limiter || e.role || e.family_id)]
    default:
      return [time, level, event, textColumn('subject', '主体', e => subjectOf(e)), textColumn('summary', '摘要', e => summaryOf(e))]
  }
}

const columns = computed<ColumnDef<ILogEntry>[]>(() => buildColumns(selectedEvent.value))

function toggleLevel(level: string) {
  const index = selectedLevels.value.indexOf(level)
  if (index === -1)
    selectedLevels.value.push(level)
  else
    selectedLevels.value.splice(index, 1)
}

function validateFilters(showToast = true): boolean {
  if (!startDate.value || !endDate.value) {
    if (showToast)
      toast.error('请选择完整的日期范围')
    return false
  }
  if (startDate.value > endDate.value) {
    if (showToast)
      toast.error('开始日期不能晚于结束日期')
    return false
  }
  const diff = (new Date(endDate.value).getTime() - new Date(startDate.value).getTime()) / 86400000
  if (diff > 31) {
    if (showToast)
      toast.error('日期范围不能超过 31 天')
    return false
  }
  if (startTime.value > endTime.value) {
    if (showToast)
      toast.error('开始时间不能晚于结束时间')
    return false
  }
  return true
}

async function fetchLogs(silent = false) {
  if (!validateFilters(!silent))
    return
  loading.value = true
  try {
    const res = await getSystemLogs({
      startDate: startDate.value,
      endDate: endDate.value,
      startTime: startTime.value,
      endTime: endTime.value,
      levels: selectedLevels.value.join(','),
      event: selectedEvent.value === 'all' ? '' : selectedEvent.value,
      player: playerQuery.value.trim(),
      keyword: keyword.value.trim(),
      page: currentPage.value,
      pageSize: pageSize.value,
    })
    if (res.code === 200) {
      entries.value = res.data.entries
      total.value = res.data.pagination.total
    }
    else {
      toast.error(res.msg || '获取日志失败')
    }
  }
  catch {
    toast.error('获取日志失败')
  }
  finally {
    loading.value = false
  }
}

let autoFetchTimer: ReturnType<typeof setTimeout> | null = null
let suppressAutoFetch = false

function scheduleAutoFetch() {
  if (suppressAutoFetch)
    return
  if (autoFetchTimer)
    clearTimeout(autoFetchTimer)
  autoFetchTimer = setTimeout(() => {
    currentPage.value = 1
    fetchLogs(true)
  }, 300)
}

watch([startDate, endDate, startTime, endTime, selectedEvent, playerQuery, keyword], scheduleAutoFetch)
watch(selectedLevels, scheduleAutoFetch, { deep: true })

function handleSearch() {
  if (autoFetchTimer) {
    clearTimeout(autoFetchTimer)
    autoFetchTimer = null
  }
  currentPage.value = 1
  fetchLogs()
}

function handleReset() {
  suppressAutoFetch = true
  startDate.value = defaultStart
  endDate.value = defaultEnd
  startTime.value = '00:00'
  endTime.value = '23:59'
  selectedLevels.value = []
  selectedEvent.value = 'all'
  playerQuery.value = ''
  keyword.value = ''
  currentPage.value = 1
  nextTick(() => {
    suppressAutoFetch = false
    fetchLogs()
  })
}

function handlePageChange(page: number) {
  if (autoFetchTimer) {
    clearTimeout(autoFetchTimer)
    autoFetchTimer = null
  }
  currentPage.value = page
  fetchLogs()
}

function handlePageSizeChange(size: number) {
  if (autoFetchTimer) {
    clearTimeout(autoFetchTimer)
    autoFetchTimer = null
  }
  pageSize.value = size
  currentPage.value = 1
  fetchLogs()
}

function handleRefresh() {
  fetchLogs()
  toast.success('已刷新日志')
}

const serverPagination = computed(() => ({
  page: currentPage.value,
  pageSize: pageSize.value,
  total: total.value,
  onPageChange: handlePageChange,
  onPageSizeChange: handlePageSizeChange,
}))

const tableProps = reactive({
  columns: columns.value,
  data: entries,
  serverPagination,
})

watch(columns, (value) => {
  tableProps.columns = value
})

const table = useGenerateVueTable<ILogEntry>(tableProps)

onMounted(fetchLogs)
</script>

<template>
  <BasicPage title="日志查询" description="查询按日 JSONL 中的全部日志，可按日期、时间、级别和事件类型筛选" sticky>
    <template #actions>
      <div class="flex items-center gap-2">
        <UiButton variant="outline" size="sm" :disabled="loading" @click="handleRefresh">
          <RefreshCwIcon class="size-4 mr-1" />
          刷新
        </UiButton>
      </div>
    </template>

    <div class="space-y-4">
      <div class="space-y-3 rounded-lg border p-3">
        <div class="flex items-center gap-3 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="text-sm text-muted-foreground">日期:</span>
            <UiInput v-model="startDate" type="date" class="w-[150px]" />
            <span class="text-muted-foreground">至</span>
            <UiInput v-model="endDate" type="date" class="w-[150px]" />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-muted-foreground">时间:</span>
            <UiInput v-model="startTime" type="time" class="w-[110px]" />
            <span class="text-muted-foreground">至</span>
            <UiInput v-model="endTime" type="time" class="w-[110px]" />
          </div>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="text-sm text-muted-foreground">事件:</span>
            <UiSelect :model-value="selectedEvent" @update:model-value="(v: any) => { selectedEvent = String(v) }">
              <UiSelectTrigger class="w-[150px]">
                <UiSelectValue placeholder="全部事件" />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem v-for="item in EVENT_OPTIONS" :key="item.value" :value="item.value">
                  {{ item.label }}
                </UiSelectItem>
              </UiSelectContent>
            </UiSelect>
          </div>
          <UiInput v-model="playerQuery" placeholder="玩家名 / XUID / UID" class="w-[190px]" />
          <UiInput v-model="keyword" placeholder="关键词（搜索全部字段）" class="w-[220px]" />
          <UiButton size="sm" :disabled="loading" @click="handleSearch">
            <SearchIcon class="size-4 mr-1" />
            查询
          </UiButton>
          <UiButton variant="outline" size="sm" :disabled="loading" @click="handleReset">
            重置
          </UiButton>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm text-muted-foreground">级别:</span>
          <UiButton
            v-for="item in LEVELS"
            :key="item.value"
            size="sm"
            :variant="selectedLevels.includes(item.value) ? 'default' : 'outline'"
            @click="toggleLevel(item.value)"
          >
            {{ item.label }}
          </UiButton>
          <span class="text-xs text-muted-foreground">（不选表示全部）</span>
        </div>

        <div class="text-sm text-muted-foreground">
          共 {{ total }} 条记录
        </div>
      </div>

      <div class="overflow-x-auto">
        <DataTable :loading :data="entries" :columns="tableProps.columns" :table :server-pagination="serverPagination" />
      </div>
    </div>
  </BasicPage>
</template>
