<script setup lang="ts">
import { EyeIcon, EyeOffIcon, RefreshCwIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IPlayerDetail } from '@/services/api/player.api'
import type { IPlayTimeHeatmap } from '@/services/api/playtime.api'

import { usePlayerApi } from '@/services/api/player.api'
import { usePlaytimeApi } from '@/services/api/playtime.api'

const { getPlayTimeHeatmap } = usePlaytimeApi()
const { getPlayerDetail } = usePlayerApi()

const loading = ref(true)
const heatmap = ref<IPlayTimeHeatmap | null>(null)
const detail = ref<IPlayerDetail | null>(null)
const showSensitive = ref(false)

async function fetchData() {
  loading.value = true
  try {
    const heatRes = await getPlayTimeHeatmap()
    if (heatRes.code !== 200) {
      toast.error(heatRes.msg || '获取个人信息失败')
      return
    }
    heatmap.value = heatRes.data

    const detailRes = await getPlayerDetail(heatRes.data.xuid)
    if (detailRes.code === 200) {
      detail.value = detailRes.data
    }
    else {
      toast.error(detailRes.msg || '获取玩家详情失败')
      detail.value = null
    }
  }
  catch (error: any) {
    const msg = error?.data?.msg || error?.message || '网络错误'
    toast.error(`获取个人信息失败: ${msg}`)
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchData()
})

// ==================== 详情字段格式化，与玩家详情弹窗一致 ====================

const pd = computed<Record<string, any> | null>(() => {
  const p = detail.value?.playerData
  return (p && typeof p === 'object') ? p as Record<string, any> : null
})

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
  if (expire < Date.now())
    return '已过期'
  return new Date(expire).toLocaleString('zh-CN')
}

function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null)
    return '-'
  return n.toLocaleString()
}

function stripFormatting(text: string): string {
  return text.replace(/§[0-9a-fk-or]/gi, '')
}

const countData = computed(() => {
  const c = pd.value?.count
  return (c && typeof c === 'object') ? c as Record<string, any> : null
})

const bankData = computed(() => {
  const b = pd.value?.bankdata
  return (b && typeof b === 'object') ? b as { current?: { balance?: number, totalInterest?: number } } : null
})

const vipData = computed(() => {
  const v = pd.value?.vipdata
  return (v && typeof v === 'object') ? v as { expireTime?: number, permanent?: boolean } : null
})

const taxData = computed(() => {
  const t = pd.value?.taxdata
  return (t && typeof t === 'object') ? t as { totalTax?: number } : null
})

// 冒险等级：rw 格式为 "1-48"，表示已领取至48级
const adventureLevel = computed(() => {
  const rw = pd.value?.rw
  if (typeof rw !== 'string' || !rw.includes('-'))
    return null
  const max = Number.parseInt(rw.split('-')[1])
  return Number.isNaN(max) ? null : max
})

// Block ++ Credit 连锁计划额度
const PLAN_LIMITS: Record<string, number> = {
  free: 1000,
  lite: 2000,
  standard: 5000,
  pro: 8000,
  max: 50000,
}

const chainPlanData = computed(() => {
  const cp = pd.value?.chainPlan
  if (!cp || typeof cp !== 'object')
    return null
  const data = cp as { plan?: string, dailyUsed?: number }
  const plan = data.plan || 'free'
  const used = data.dailyUsed ?? 0
  const unlimited = plan === 'ultra'
  const limit = unlimited ? Infinity : (PLAN_LIMITS[plan] ?? 1000)
  const pct = unlimited ? 0 : Math.min(100, (used / limit) * 100)
  return { plan, used, limit, unlimited, pct }
})

const signData = computed(() => {
  const s = pd.value?.sign
  if (!s || typeof s !== 'object')
    return null
  const data = s as { lastDate?: string, consecutive?: number }
  return { lastDate: data.lastDate || '无', consecutive: data.consecutive ?? 0 }
})

const avatarUrl = computed(() => {
  const a = pd.value?.avatar
  if (!a || typeof a !== 'object')
    return null
  const avatar = a as { type?: string, value?: string }
  if (avatar.type === 'qq' && avatar.value)
    return `https://q1.qlogo.cn/g?b=qq&nk=${avatar.value}&s=100`
  return null
})

const nameInitial = computed(() => {
  return (detail.value?.name || '?').charAt(0).toUpperCase()
})

const basicFields = computed(() => {
  const d = detail.value
  if (!d)
    return []
  return [
    { label: 'UID', value: String(d.uid ?? '-'), mono: true },
    { label: '玩家名', value: d.name || '-', mono: false },
    { label: '注册时间', value: d.registerTime || '-', mono: false },
    { label: '余额', value: formatNumber(d.balance), mono: true },
    { label: '操作平台', value: d.platform || '-', mono: false },
  ]
})

const sensitiveFields = computed(() => {
  const d = detail.value
  if (!d)
    return []
  return [
    { label: 'XUID', value: d.xuid || '-', mono: true },
    { label: 'UUID', value: d.uuid || '-', mono: true },
    { label: '上次登录IP', value: d.lastIp || '-', mono: true },
  ]
})

const statFields = computed(() => {
  const c = countData.value
  return [
    { label: '挖矿数', value: c ? formatNumber(c.mining) : '-' },
    { label: '放置数', value: c ? formatNumber(c.placing) : '-' },
    { label: '击杀数', value: c ? formatNumber(c.kills) : '-' },
    { label: '死亡数', value: c ? formatNumber(c.deaths) : '-' },
    { label: '游戏时长', value: formatPlayTime(c?.playTime ?? 0) },
  ]
})

const economyFields = computed(() => {
  return [
    { label: '银行余额', value: bankData.value?.current?.balance ? formatNumber(bankData.value.current.balance) : '0' },
    { label: '银行利息', value: bankData.value?.current?.totalInterest ? formatNumber(bankData.value.current.totalInterest) : '0' },
    { label: '税收总额', value: taxData.value ? formatNumber(taxData.value.totalTax) : '-' },
    { label: 'VIP到期', value: vipData.value?.permanent ? '永久' : formatVipExpire(vipData.value?.expireTime ?? null) },
  ]
})

// 称号：清理颜色码后显示
const titlesText = computed(() => {
  const t = pd.value?.titles
  if (!t || typeof t !== 'object')
    return '无'
  const data = t as { owned?: string[], active?: string }
  const owned = (data.owned || []).map((item: string) => stripFormatting(item)).join('、') || '无'
  const active = data.active ? stripFormatting(data.active) : '无'
  return `拥有: ${owned} | 当前: ${active}`
})

const signText = computed(() => {
  if (!signData.value)
    return '无'
  return `最后签到: ${signData.value.lastDate} | 连续: ${signData.value.consecutive}天`
})

// ==================== 热力图 ====================

const weeks = computed<(IPlayTimeHeatmap['days'][0] | null)[][]>(() => {
  if (!heatmap.value)
    return []
  const days = heatmap.value.days
  if (!days.length)
    return []
  const first = new Date(`${days[0].date}T00:00:00`)
  const lead = first.getDay()
  const cells: (IPlayTimeHeatmap['days'][0] | null)[] = [...Array.from({ length: lead }, () => null as IPlayTimeHeatmap['days'][0] | null), ...days]
  const result: (IPlayTimeHeatmap['days'][0] | null)[][] = []
  for (let i = 0; i < cells.length; i += 7)
    result.push(cells.slice(i, i + 7))
  return result
})

const monthLabels = computed<{ col: number, label: string }[]>(() => {
  const labels: { col: number, label: string }[] = []
  let prevMonth = -1
  weeks.value.forEach((week, col) => {
    const firstDay = week.find(d => d !== null)
    if (!firstDay)
      return
    const month = new Date(`${firstDay.date}T00:00:00`).getMonth()
    if (month !== prevMonth) {
      labels.push({ col, label: String(month + 1) })
      prevMonth = month
    }
  })
  return labels
})

const weekdayLabels = ['周日', '周一', '', '周三', '', '周五', '']

const levelColors = ['#9be9a8', '#40c463', '#30a14e', '#216e39', '#0e4429']

function cellColor(day: IPlayTimeHeatmap['days'][0] | null) {
  if (!day || day.level === 0)
    return 'var(--muted)'
  return levelColors[day.level - 1]
}

function formatDuration(seconds: number) {
  if (seconds <= 0)
    return '无游戏记录'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0)
    return `${m} 分钟`
  if (m === 0)
    return `${h} 小时`
  return `${h} 小时 ${m} 分钟`
}

const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function cellTitle(day: IPlayTimeHeatmap['days'][0]) {
  const d = new Date(`${day.date}T00:00:00`)
  const dateStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${weekdayNames[d.getDay()]}`
  if (day.seconds <= 0)
    return `${dateStr}无游戏记录`
  return `${dateStr}游戏 ${formatDuration(day.seconds)}`
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center gap-2 p-4 border-b">
      <h1 class="text-lg font-semibold">
        个人信息
      </h1>
      <span class="text-sm text-muted-foreground">玩家资料与游戏时长</span>
      <div class="flex-1" />
      <UiButton variant="outline" size="sm" @click="fetchData">
        <RefreshCwIcon class="size-4 mr-1" />
        刷新
      </UiButton>
    </div>

    <div class="flex-1 overflow-auto p-4">
      <div v-if="loading" class="flex items-center justify-center py-12">
        <UiSpinner class="size-6" />
      </div>

      <div v-else-if="!detail" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p class="text-sm">
          暂无数据
        </p>
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <!-- 左侧：头像与基本信息 -->
        <div class="border rounded-lg p-4 space-y-4 h-full">
          <div class="flex items-center gap-4">
            <img
              v-if="avatarUrl"
              :src="avatarUrl"
              alt="头像"
              class="size-16 rounded-full border object-cover"
            >
            <div
              v-else
              class="size-16 rounded-full border bg-muted flex items-center justify-center text-xl font-semibold text-muted-foreground"
            >
              {{ nameInitial }}
            </div>
            <div class="min-w-0">
              <p class="text-base font-semibold truncate">
                {{ detail.name }}
              </p>
              <p class="text-xs text-muted-foreground font-mono">
                UID: {{ detail.uid }}
              </p>
              <UiBadge v-if="detail.isOnline" class="mt-1" variant="default">
                在线
              </UiBadge>
              <UiBadge v-else class="mt-1" variant="secondary">
                离线
              </UiBadge>
            </div>
          </div>

          <UiSeparator />

          <div class="space-y-3">
            <div v-for="field in basicFields" :key="field.label" class="space-y-0.5">
              <span class="text-xs text-muted-foreground">{{ field.label }}</span>
              <p class="text-sm break-all" :class="field.mono ? 'font-mono' : 'font-medium'">
                {{ field.value }}
              </p>
            </div>
          </div>

          <UiSeparator />

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs text-muted-foreground">敏感信息</span>
              <UiButton variant="ghost" size="icon" class="size-6" @click="showSensitive = !showSensitive">
                <EyeIcon v-if="!showSensitive" class="size-4" />
                <EyeOffIcon v-else class="size-4" />
              </UiButton>
            </div>
            <div v-for="field in sensitiveFields" :key="field.label" class="space-y-0.5">
              <span class="text-xs text-muted-foreground">{{ field.label }}</span>
              <p class="text-sm break-all font-mono">
                {{ showSensitive ? field.value : '••••••••••••' }}
              </p>
            </div>
          </div>
        </div>

        <!-- 右侧：热力图与统计 -->
        <div class="space-y-4 min-w-0">
          <!-- 热力图 -->
          <div class="border rounded-lg p-4">
            <div class="overflow-x-auto pb-1">
              <div class="mx-auto w-fit">
                <div class="flex items-center mb-1 ml-8">
                  <div
                    class="grid gap-[3px] text-[10px] text-muted-foreground"
                    :style="{ gridTemplateRows: '14px', gridAutoFlow: 'column', gridAutoColumns: '11px' }"
                  >
                    <template v-for="(_, col) in weeks" :key="col">
                      <span>{{ monthLabels.find(m => m.col === col)?.label || '' }}</span>
                    </template>
                  </div>
                </div>

                <div class="flex">
                  <div class="flex flex-col gap-[3px] mr-1 w-7 text-[10px] text-muted-foreground">
                    <span v-for="label in weekdayLabels" :key="label" class="h-[11px] leading-[11px]">
                      {{ label }}
                    </span>
                  </div>

                  <UiTooltipProvider :delay-duration="0" :skip-delay-duration="0">
                    <div
                      class="grid gap-[3px]"
                      :style="{ gridTemplateRows: 'repeat(7, 11px)', gridAutoFlow: 'column', gridAutoColumns: '11px' }"
                    >
                      <template v-for="(week, col) in weeks" :key="col">
                        <template v-for="(day, row) in week" :key="`${col}-${row}`">
                          <UiTooltip v-if="day">
                            <UiTooltipTrigger as-child>
                              <span
                                class="block size-[11px] rounded-[2px] cursor-pointer outline-none"
                                :style="{ backgroundColor: cellColor(day) }"
                              />
                            </UiTooltipTrigger>
                            <UiTooltipContent side="top" class="text-xs">
                              {{ cellTitle(day) }}
                            </UiTooltipContent>
                          </UiTooltip>
                          <span v-else class="size-[11px] rounded-[2px]" />
                        </template>
                      </template>
                    </div>
                  </UiTooltipProvider>
                </div>

                <div class="flex items-center justify-end gap-1 mt-2 text-[10px] text-muted-foreground">
                  <span>少</span>
                  <span class="size-[11px] rounded-[2px]" style="background-color: var(--muted)" />
                  <span
                    v-for="color in levelColors"
                    :key="color"
                    class="size-[11px] rounded-[2px]"
                    :style="{ backgroundColor: color }"
                  />
                  <span>多</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 统计数据 -->
          <div class="border rounded-lg p-4">
            <h3 class="text-sm font-semibold mb-3">
              统计数据
            </h3>
            <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
              <div v-for="field in statFields" :key="field.label" class="space-y-0.5">
                <span class="text-xs text-muted-foreground">{{ field.label }}</span>
                <p class="font-mono">
                  {{ field.value }}
                </p>
              </div>
            </div>
          </div>

          <!-- 经济信息 -->
          <div class="border rounded-lg p-4">
            <h3 class="text-sm font-semibold mb-3">
              经济信息
            </h3>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div v-for="field in economyFields" :key="field.label" class="space-y-0.5">
                <span class="text-xs text-muted-foreground">{{ field.label }}</span>
                <p class="font-mono">
                  {{ field.value }}
                </p>
              </div>
            </div>
          </div>

          <!-- 其他数据 -->
          <div class="border rounded-lg p-4">
            <h3 class="text-sm font-semibold mb-3">
              其他数据
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm mb-4">
              <div class="space-y-0.5">
                <span class="text-xs text-muted-foreground">冒险等级</span>
                <p class="font-mono">
                  {{ adventureLevel ?? '-' }}
                </p>
              </div>
              <div class="space-y-0.5 sm:col-span-2">
                <span class="text-xs text-muted-foreground">称号</span>
                <p class="break-all">
                  {{ titlesText }}
                </p>
              </div>
              <div class="space-y-0.5 sm:col-span-3">
                <span class="text-xs text-muted-foreground">签到</span>
                <p class="font-mono">
                  {{ signText }}
                </p>
              </div>
            </div>

            <!-- Block ++ Credit 额度进度 -->
            <div v-if="chainPlanData" class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Block ++ Credit</span>
                <UiBadge variant="secondary">
                  {{ chainPlanData.plan }}
                </UiBadge>
              </div>
              <UiProgress :model-value="chainPlanData.pct" class="h-2" />
              <p class="text-xs text-muted-foreground">
                今日额度 {{ formatNumber(chainPlanData.used) }} / {{ chainPlanData.unlimited ? '无限制' : formatNumber(chainPlanData.limit) }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
