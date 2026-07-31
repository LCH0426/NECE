<script setup lang="ts">
import type { IPlayer, IPlayerDetail } from '@/services/api/player.api'

import { usePlayerApi } from '@/services/api/player.api'

const props = defineProps<{
  player: IPlayer
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'close': []
}>()

const { getPlayerDetail } = usePlayerApi()

const detail = ref<IPlayerDetail | null>(null)
const loading = ref(false)

const dimensionMap: Record<number, string> = {
  0: '主世界',
  1: '下界',
  2: '末地',
}

const gameModeMap: Record<number, string> = {
  0: '生存',
  1: '创造',
  2: '冒险',
  3: '旁观',
}

function formatPlayTime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0)
    return `${days}天${hours}时${minutes}分`
  if (hours > 0)
    return `${hours}时${minutes}分`
  return `${minutes}分`
}

function formatVipExpire(expire: number | null): string {
  if (!expire)
    return '无'
  const now = Date.now()
  if (expire < now)
    return '已过期'
  return new Date(expire).toLocaleString('zh-CN')
}

function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null)
    return '-'
  return n.toLocaleString()
}

const countData = computed(() => {
  const pd = detail.value?.playerData
  if (!pd?.count || typeof pd.count !== 'object')
    return null
  return pd.count as Record<string, any>
})

const bankData = computed(() => {
  const pd = detail.value?.playerData
  if (!pd?.bankdata || typeof pd.bankdata !== 'object')
    return null
  return pd.bankdata as { current?: { balance?: number, totalInterest?: number, lastInterestTime?: string }, fixed?: any[] }
})

const vipData = computed(() => {
  const pd = detail.value?.playerData
  if (!pd?.vipdata || typeof pd.vipdata !== 'object')
    return null
  return pd.vipdata as { expireTime?: number, totalSaved?: number }
})

const taxData = computed(() => {
  const pd = detail.value?.playerData
  if (!pd?.taxdata || typeof pd.taxdata !== 'object')
    return null
  return pd.taxdata as { totalTax?: number }
})

const lastIpDisplay = computed(() => {
  if (detail.value?.lastIp)
    return detail.value.lastIp
  const pd = detail.value?.playerData
  if (pd?.lastIp && typeof pd.lastIp === 'string' && pd.lastIp.trim() !== '')
    return pd.lastIp
  return '-'
})

const platformDisplay = computed(() => {
  if (detail.value?.platform)
    return detail.value.platform
  const pd = detail.value?.playerData
  if (pd?.platform && typeof pd.platform === 'string' && pd.platform.trim() !== '')
    return pd.platform
  return '-'
})

const extraFieldLabels: Record<string, string> = {
  uid: 'UID',
  registerTime: '注册时间',
  name: 'ID',
  uuid: 'UUID',
  healthBonus: '生命提升',
  rw: '等级奖励',
  avatar: '头像参数',
  titles: '称号',
  chain: '连锁挖矿',
  chainPlan: '连锁计划',
  dustshop: '星尘商店',
  sign: '签到',
}

const extraFieldFormatters: Record<string, (value: any) => string> = {
  avatar: (value: any) => {
    if (typeof value === 'object' && value !== null) {
      if (value.type === 'qq')
        return `QQ头像 (QQ号: ${value.value})`
      return JSON.stringify(value)
    }
    return String(value)
  },
  titles: (value: any) => {
    if (typeof value === 'object' && value !== null) {
      const owned = value.owned?.join('、') || '无'
      const active = value.active || '无'
      return `拥有: ${owned} | 当前: ${active}`
    }
    return String(value)
  },
  chain: (value: any) => {
    if (typeof value === 'object' && value !== null) {
      const status = value.enabled ? '已开启' : '已关闭'
      const mode = value.mineAll ? '全部挖掘' : '单个挖掘'
      const sneak = value.sneakOnly ? '仅潜行' : '随时'
      return `${status} | ${mode} | ${sneak}`
    }
    return String(value)
  },
  chainPlan: (value: any) => {
    if (typeof value === 'object' && value !== null) {
      const plan = value.plan || '无'
      const used = value.dailyUsed ?? 0
      const expire = value.expireTime ? new Date(value.expireTime).toLocaleDateString('zh-CN') : '无'
      return `方案: ${plan} | 今日使用: ${used} | 到期: ${expire}`
    }
    return String(value)
  },
  sign: (value: any) => {
    if (typeof value === 'object' && value !== null) {
      const lastDate = value.lastDate || '无'
      const consecutive = value.consecutive ?? 0
      return `最后签到: ${lastDate} | 连续: ${consecutive}天`
    }
    return String(value)
  },
}

const extraFields = computed(() => {
  const pd = detail.value?.playerData
  if (!pd)
    return []
  const knownKeys = new Set(['count', 'bankdata', 'vipdata', 'taxdata', 'quickmenu', 'leavetime', 'lastIp', 'platform', 'uid', 'name', 'uuid', 'registerTime', 'avatar'])
  const fields: { key: string, label: string, value: string }[] = []
  for (const [key, value] of Object.entries(pd)) {
    if (knownKeys.has(key))
      continue
    if (value === undefined || value === null || value === '')
      continue
    const formatter = extraFieldFormatters[key]
    const displayValue = formatter ? formatter(value) : (typeof value === 'object' ? JSON.stringify(value) : String(value))
    fields.push({ key, label: extraFieldLabels[key] || key, value: displayValue })
  }
  return fields
})

const avatarUrl = computed(() => {
  const pd = detail.value?.playerData
  if (!pd?.avatar || typeof pd.avatar !== 'object')
    return null
  const avatar = pd.avatar as { type?: string, value?: string }
  if (avatar.type === 'qq' && avatar.value)
    return `https://q1.qlogo.cn/g?b=qq&nk=${avatar.value}&s=100`
  return null
})

async function fetchDetail() {
  loading.value = true
  try {
    const res = await getPlayerDetail(props.player.xuid)
    if (res.code === 200)
      detail.value = res.data
  }
  catch {}
  finally {
    loading.value = false
  }
}

watch(() => props.open, (val) => {
  if (val)
    fetchDetail()
}, { immediate: true })

function handleClose() {
  emit('update:open', false)
  emit('close')
}
</script>

<template>
  <UiDialog :open="open" @update:open="handleClose">
    <UiDialogContent class="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle>玩家详情</UiDialogTitle>
        <UiDialogDescription>
          {{ player.name }} (UID: {{ player.uid }})
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="loading" class="flex items-center justify-center py-8">
        <UiSpinner class="size-6" />
      </div>

      <div v-else-if="detail" class="space-y-4 py-2">
        <div>
          <h4 class="text-sm font-semibold mb-2 text-foreground/80">
            基本信息
          </h4>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="space-y-1">
              <span class="text-muted-foreground">UID</span>
              <p class="font-mono">
                {{ detail.uid }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">玩家名</span>
              <p class="font-medium">
                {{ detail.name }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">XUID</span>
              <p class="font-mono text-xs">
                {{ detail.xuid }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">UUID</span>
              <p class="font-mono text-xs">
                {{ detail.uuid }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">注册时间</span>
              <p>{{ detail.registerTime }}</p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">余额</span>
              <p class="font-mono">
                {{ detail.balance.toLocaleString() }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">上次登录IP</span>
              <p class="font-mono text-xs">
                {{ lastIpDisplay }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">操作平台</span>
              <p>{{ platformDisplay }}</p>
            </div>
          </div>
        </div>

        <UiSeparator />

        <div>
          <h4 class="text-sm font-semibold mb-2 text-foreground/80">
            统计数据
          </h4>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="space-y-1">
              <span class="text-muted-foreground">挖矿数</span>
              <p class="font-mono">
                {{ countData ? formatNumber(countData.mining) : '-' }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">放置数</span>
              <p class="font-mono">
                {{ countData ? formatNumber(countData.placing) : '-' }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">击杀数</span>
              <p class="font-mono">
                {{ countData ? formatNumber(countData.kills) : '-' }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">死亡数</span>
              <p class="font-mono">
                {{ countData ? formatNumber(countData.deaths) : '-' }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">游戏时长</span>
              <p>{{ formatPlayTime(countData?.playTime ?? player.playTime) }}</p>
            </div>
          </div>
        </div>

        <UiSeparator />

        <div>
          <h4 class="text-sm font-semibold mb-2 text-foreground/80">
            经济信息
          </h4>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="space-y-1">
              <span class="text-muted-foreground">银行余额</span>
              <p class="font-mono">
                {{ bankData?.current?.balance ? formatNumber(bankData.current.balance) : '0' }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">银行利息</span>
              <p class="font-mono">
                {{ bankData?.current?.totalInterest ? formatNumber(bankData.current.totalInterest) : '0' }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">税收总额</span>
              <p class="font-mono">
                {{ taxData ? formatNumber(taxData.totalTax) : '-' }}
              </p>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground">VIP到期</span>
              <p>{{ formatVipExpire(vipData?.expireTime ?? player.vipExpire) }}</p>
            </div>
          </div>
        </div>

        <template v-if="detail.isOnline && detail.onlineInfo">
          <UiSeparator />
          <div>
            <h4 class="text-sm font-semibold mb-2 text-foreground/80">
              在线信息
            </h4>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div class="space-y-1">
                <span class="text-muted-foreground">IP</span>
                <p class="font-mono text-xs">
                  {{ detail.onlineInfo.ip }}
                </p>
              </div>
              <div class="space-y-1">
                <span class="text-muted-foreground">维度</span>
                <p>{{ dimensionMap[detail.onlineInfo.dimension] || `未知(${detail.onlineInfo.dimension})` }}</p>
              </div>
              <div class="space-y-1">
                <span class="text-muted-foreground">游戏模式</span>
                <p>{{ gameModeMap[detail.onlineInfo.gameMode] || `未知(${detail.onlineInfo.gameMode})` }}</p>
              </div>
              <div class="space-y-1">
                <span class="text-muted-foreground">延迟</span>
                <p>{{ detail.onlineInfo.ping }}ms</p>
              </div>
            </div>
          </div>
        </template>

        <template v-if="extraFields.length > 0">
          <UiSeparator />
          <div>
            <h4 class="text-sm font-semibold mb-2 text-foreground/80">
              其他数据
            </h4>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div v-for="field in extraFields" :key="field.key" class="space-y-1">
                <span class="text-muted-foreground">{{ field.label }}</span>
                <p class="font-mono">
                  {{ field.value }}
                </p>
              </div>
            </div>
            <div v-if="avatarUrl" class="mt-3 flex items-center gap-3">
              <img :src="avatarUrl" alt="QQ头像" class="size-12 rounded-full border">
              <span class="text-xs text-muted-foreground">QQ头像</span>
            </div>
          </div>
        </template>
      </div>

      <UiDialogFooter>
        <UiButton variant="outline" @click="handleClose">
          关闭
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
