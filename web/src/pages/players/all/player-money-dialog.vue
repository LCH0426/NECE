<script setup lang="ts">
import { ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon, TrendingUpIcon } from '@lucide/vue'

import type { IEconomyPoint, IPlayer } from '@/services/api/player.api'

import { usePlayerApi } from '@/services/api/player.api'

const props = defineProps<{
  player: IPlayer
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'success': []
}>()

const { moneyOperation, getEconomyHistory } = usePlayerApi()

const action = ref<'add' | 'reduce' | 'set'>('add')
const amount = ref<number | undefined>(undefined)
const submitting = ref(false)
const result = ref<{ before: number, after: number } | null>(null)
const errorMsg = ref('')

const points = ref<IEconomyPoint[]>([])
const historyLoading = ref(false)
const historyError = ref('')
const truncated = ref(false)
const totalPoints = ref(0)
const listPage = ref(1)
const listPageSize = 10

const chartScroll = ref<HTMLElement | null>(null)

const ACTION_LABELS: Record<string, string> = {
  reduce: '扣费',
  add: '入账',
  transfer: '转账',
  buy: '购买',
  sell: '出售',
  recycle: '回收',
}

const currentBalance = computed(() => result.value ? result.value.after : props.player.balance)

const chartPoints = computed(() => points.value
  .filter(item => typeof item.balance === 'number')
  .map((item, index) => ({ ...item, index })))

const CHART_HEIGHT = 320
const CHART_MARGIN = { left: 72, right: 24, top: 16, bottom: 32 }
const PLOT_HEIGHT = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom

const chartWidth = computed(() => Math.min(60000, Math.max(1800, chartPoints.value.length * 24)))

const yDomain = computed<[number, number]>(() => {
  const values = chartPoints.value.map(item => item.balance as number)
  if (values.length === 0)
    return [0, 100]
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) {
    min = Math.max(0, min - 1)
    max = max + 1
  }
  const padding = Math.max(1, Math.round((max - min) * 0.08))
  return [Math.max(0, min - padding), max + padding]
})

const sortedPoints = computed(() => [...points.value].reverse())

function xFor(index: number, count: number): number {
  const plotWidth = chartWidth.value - CHART_MARGIN.left - CHART_MARGIN.right
  if (count <= 1)
    return CHART_MARGIN.left + plotWidth / 2
  return CHART_MARGIN.left + (index / (count - 1)) * plotWidth
}

function yFor(balance: number): number {
  const [min, max] = yDomain.value
  if (max === min)
    return CHART_MARGIN.top + PLOT_HEIGHT / 2
  return CHART_MARGIN.top + (1 - (balance - min) / (max - min)) * PLOT_HEIGHT
}

const plottedPoints = computed(() => {
  const count = chartPoints.value.length
  return chartPoints.value.map(item => ({
    ...item,
    cx: xFor(item.index, count),
    cy: yFor(item.balance as number),
  }))
})

const yTicks = computed(() => {
  const [min, max] = yDomain.value
  return [0, 1, 2, 3, 4].map((i) => {
    const value = Math.round(min + ((max - min) * i) / 4)
    return { value, y: yFor(value) }
  })
})

const xTicks = computed(() => {
  const list = plottedPoints.value
  if (list.length === 0)
    return []
  const count = Math.min(8, list.length)
  const ticks: { x: number, label: string }[] = []
  for (let i = 0; i < count; i++) {
    const index = count === 1 ? 0 : Math.round((i * (list.length - 1)) / (count - 1))
    ticks.push({ x: list[index].cx, label: list[index].time.slice(5, 16) })
  }
  return ticks
})

const greenPath = computed(() => {
  let d = ''
  const list = plottedPoints.value
  for (let i = 1; i < list.length; i++) {
    if (list[i].delta >= 0)
      d += `M${list[i - 1].cx} ${list[i - 1].cy}L${list[i].cx} ${list[i].cy}`
  }
  return d
})

const redPath = computed(() => {
  let d = ''
  const list = plottedPoints.value
  for (let i = 1; i < list.length; i++) {
    if (list[i].delta < 0)
      d += `M${list[i - 1].cx} ${list[i - 1].cy}L${list[i].cx} ${list[i].cy}`
  }
  return d
})

const listTotalPages = computed(() => Math.max(1, Math.ceil(sortedPoints.value.length / listPageSize)))
const pagedPoints = computed(() => {
  const start = (listPage.value - 1) * listPageSize
  return sortedPoints.value.slice(start, start + listPageSize)
})

function scrollToLatest() {
  nextTick(() => {
    const el = chartScroll.value
    if (el)
      el.scrollLeft = el.scrollWidth
  })
}

function handleWheel(event: WheelEvent) {
  const el = chartScroll.value
  if (!el)
    return
  hidePointTooltip()
  el.scrollLeft += event.deltaX !== 0 ? event.deltaX : event.deltaY
}

let touchStartX = 0
let touchStartScroll = 0
let touching = false

function handleTouchStart(event: TouchEvent) {
  if (!event.touches.length)
    return
  hidePointTooltip()
  touching = true
  touchStartX = event.touches[0].clientX
  touchStartScroll = chartScroll.value ? chartScroll.value.scrollLeft : 0
}

function handleTouchMove(event: TouchEvent) {
  const el = chartScroll.value
  if (!touching || !el || !event.touches.length)
    return
  el.scrollLeft = touchStartScroll - (event.touches[0].clientX - touchStartX)
}

function handleTouchEnd() {
  touching = false
}

const hoveredPoint = ref<{ point: IEconomyPoint, x: number, y: number } | null>(null)

function showPointTooltip(point: IEconomyPoint, event: MouseEvent) {
  hoveredPoint.value = { point, x: event.clientX, y: event.clientY }
}

function hidePointTooltip() {
  hoveredPoint.value = null
}

const tooltipStyle = computed(() => {
  if (!hoveredPoint.value)
    return {}
  const x = Math.min(hoveredPoint.value.x + 14, window.innerWidth - 250)
  const y = Math.min(hoveredPoint.value.y + 14, window.innerHeight - 160)
  return { left: `${x}px`, top: `${y}px` }
})

async function fetchHistory() {
  if (!props.player?.xuid)
    return
  historyLoading.value = true
  historyError.value = ''
  try {
    const res = await getEconomyHistory(props.player.xuid)
    if (res.code === 200) {
      points.value = res.data.points
      totalPoints.value = res.data.total
      truncated.value = res.data.truncated
      listPage.value = 1
      hidePointTooltip()
      scrollToLatest()
    }
    else {
      historyError.value = res.msg || '获取经济记录失败'
    }
  }
  catch {
    historyError.value = '获取经济记录失败'
  }
  finally {
    historyLoading.value = false
  }
}

async function handleSubmit() {
  if (!amount.value || amount.value <= 0) {
    errorMsg.value = '请输入有效的金额'
    return
  }
  submitting.value = true
  errorMsg.value = ''
  try {
    const res = await moneyOperation(props.player.xuid, action.value, amount.value)
    if (res.code === 200) {
      result.value = { before: res.data.before, after: res.data.after }
      emit('success')
      await fetchHistory()
      scrollToLatest()
    }
    else {
      errorMsg.value = res.msg || '操作失败'
    }
  }
  catch {
    errorMsg.value = '网络错误'
  }
  finally {
    submitting.value = false
  }
}

function handleClose() {
  emit('update:open', false)
  result.value = null
  amount.value = undefined
  action.value = 'add'
  errorMsg.value = ''
}

function resetState() {
  result.value = null
  amount.value = undefined
  action.value = 'add'
  errorMsg.value = ''
  points.value = []
  historyError.value = ''
  truncated.value = false
  totalPoints.value = 0
  listPage.value = 1
  hidePointTooltip()
}

watch(() => props.open, (val) => {
  if (val)
    fetchHistory()
  else
    resetState()
}, { immediate: true, flush: 'post' })
</script>

<template>
  <UiDialog :open="open" @update:open="handleClose">
    <UiDialogContent
      style="width: min(96vw, 1000px); max-width: min(96vw, 1000px);"
      class="max-h-[90vh] overflow-y-auto overflow-x-hidden"
    >
      <UiDialogHeader>
        <UiDialogTitle>经济管理</UiDialogTitle>
        <UiDialogDescription>
          玩家 {{ player.name }} (UID: {{ player.uid }})，当前余额: {{ currentBalance.toLocaleString() }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-4 py-2 min-w-0">
        <!-- 操作区 -->
        <div class="rounded-lg border p-3 space-y-3">
          <div class="flex items-center gap-3 flex-wrap">
            <UiSelect v-model="action">
              <UiSelectTrigger class="w-[130px]">
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
            <UiInput
              v-model="amount"
              type="number"
              placeholder="请输入金额"
              :min="1"
              class="w-[180px]"
            />
            <UiButton :disabled="submitting" @click="handleSubmit">
              {{ submitting ? '处理中...' : '确认' }}
            </UiButton>
            <UiButton variant="outline" :disabled="historyLoading" @click="fetchHistory">
              <RefreshCwIcon class="size-4 mr-1" />
              刷新记录
            </UiButton>
            <span v-if="errorMsg" class="text-sm text-destructive">{{ errorMsg }}</span>
            <span v-if="result" class="text-sm text-muted-foreground">
              已更新：{{ result.before.toLocaleString() }} → <span class="font-mono font-bold text-foreground">{{ result.after.toLocaleString() }}</span>
            </span>
          </div>
        </div>

        <!-- 余额折线图 -->
        <div class="rounded-lg border min-w-0">
          <div class="flex items-center justify-between gap-2 px-3 py-2 border-b">
            <div class="flex items-center gap-2">
              <TrendingUpIcon class="size-4 text-muted-foreground" />
              <span class="text-sm font-medium">余额变动</span>
              <span class="text-xs text-muted-foreground">
                共 {{ totalPoints }} 笔{{ truncated ? '（仅展示最新 5000 笔）' : '' }}
              </span>
            </div>
            <span class="text-xs text-muted-foreground">滚轮 / 触控左右拖动，最右侧为最新</span>
          </div>

          <div v-if="historyLoading" class="flex items-center justify-center h-[320px] text-sm text-muted-foreground">
            加载中...
          </div>
          <div v-else-if="historyError" class="flex items-center justify-center h-[320px] text-sm text-destructive">
            {{ historyError }}
          </div>
          <div v-else-if="chartPoints.length === 0" class="flex items-center justify-center h-[320px] text-sm text-muted-foreground">
            暂无经济变动记录
          </div>
          <div
            v-else
            ref="chartScroll"
            class="w-full min-w-0 overflow-x-auto overflow-y-hidden px-2 py-2 cursor-grab active:cursor-grabbing"
            style="touch-action: pan-x;"
            @wheel.prevent="handleWheel"
            @touchstart="handleTouchStart"
            @touchmove.prevent="handleTouchMove"
            @touchend="handleTouchEnd"
            @touchcancel="handleTouchEnd"
          >
            <div :style="{ width: `${chartWidth}px`, height: '320px' }">
              <svg :width="chartWidth" :height="CHART_HEIGHT" class="block">
                <g v-for="tick in yTicks" :key="tick.value">
                  <line
                    :x1="CHART_MARGIN.left"
                    :x2="chartWidth - CHART_MARGIN.right"
                    :y1="tick.y"
                    :y2="tick.y"
                    stroke="currentColor"
                    stroke-opacity="0.12"
                  />
                  <text
                    :x="CHART_MARGIN.left - 8"
                    :y="tick.y + 4"
                    text-anchor="end"
                    font-size="11"
                    class="fill-muted-foreground"
                  >{{ tick.value.toLocaleString() }}</text>
                </g>

                <text
                  v-for="(tick, index) in xTicks"
                  :key="index"
                  :x="tick.x"
                  :y="CHART_HEIGHT - 8"
                  text-anchor="middle"
                  font-size="11"
                  class="fill-muted-foreground"
                >{{ tick.label }}</text>

                <path :d="greenPath" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" />
                <path :d="redPath" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" />

                <g v-for="(point, index) in plottedPoints" :key="index">
                  <circle
                    :cx="point.cx"
                    :cy="point.cy"
                    r="3.2"
                    :fill="point.delta >= 0 ? '#16a34a' : '#dc2626'"
                    stroke="#fff"
                    stroke-width="1"
                    pointer-events="none"
                  />
                  <circle
                    :cx="point.cx"
                    :cy="point.cy"
                    r="9"
                    fill="rgba(0,0,0,0)"
                    pointer-events="all"
                    class="cursor-pointer"
                    @mouseenter="showPointTooltip(point, $event)"
                    @mousemove="showPointTooltip(point, $event)"
                    @mouseleave="hidePointTooltip"
                    @click="showPointTooltip(point, $event)"
                  />
                </g>
              </svg>
            </div>
          </div>
        </div>

        <!-- 交易明细 -->
        <div class="rounded-lg border">
          <div class="flex items-center justify-between px-3 py-2 border-b">
            <span class="text-sm font-medium">交易明细</span>
            <div class="flex items-center gap-2">
              <UiButton
                variant="outline"
                size="sm"
                :disabled="listPage <= 1"
                @click="listPage--"
              >
                <ChevronLeftIcon class="size-4" />
              </UiButton>
              <span class="text-xs text-muted-foreground">{{ listPage }} / {{ listTotalPages }}</span>
              <UiButton
                variant="outline"
                size="sm"
                :disabled="listPage >= listTotalPages"
                @click="listPage++"
              >
                <ChevronRightIcon class="size-4" />
              </UiButton>
            </div>
          </div>

          <div v-if="pagedPoints.length === 0" class="py-8 text-center text-sm text-muted-foreground">
            暂无交易记录
          </div>
          <template v-else>
            <div class="grid grid-cols-[150px_80px_110px_120px_1fr] items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/40 border-b">
              <span>时间</span>
              <span class="text-center">动作</span>
              <span>变动</span>
              <span>余额</span>
              <span>来源</span>
            </div>
            <div class="divide-y">
              <div
                v-for="(item, index) in pagedPoints"
                :key="`${item.ts}-${index}`"
                class="grid grid-cols-[150px_80px_110px_120px_1fr] items-center gap-2 px-3 py-2 text-xs hover:bg-muted/30"
              >
                <span class="font-mono text-muted-foreground whitespace-nowrap">{{ item.time }}</span>
                <span class="inline-flex items-center rounded-md border px-1.5 py-0.5 font-semibold justify-center">
                  {{ ACTION_LABELS[item.action] || item.event }}
                </span>
                <span
                  class="font-mono font-semibold whitespace-nowrap"
                  :class="item.delta >= 0 ? 'text-emerald-600' : 'text-red-500'"
                >
                  {{ item.delta >= 0 ? '+' : '' }}{{ item.delta.toLocaleString() }}
                </span>
                <span class="font-mono text-muted-foreground whitespace-nowrap">
                  {{ item.balance === null ? '-' : item.balance.toLocaleString() }}
                </span>
                <span class="truncate" :title="item.source">{{ item.source || '-' }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>

      <UiDialogFooter>
        <UiButton variant="outline" @click="handleClose">
          关闭
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>

  <Teleport to="body">
    <div
      v-if="hoveredPoint"
      class="pointer-events-none fixed z-[100] w-[240px] rounded-md border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg"
      :style="tooltipStyle"
    >
      <div class="mb-1 font-medium">
        {{ ACTION_LABELS[hoveredPoint.point.action] || hoveredPoint.point.event }}
      </div>
      <div class="text-muted-foreground">
        {{ hoveredPoint.point.time }}
      </div>
      <div class="mt-1 flex items-center justify-between">
        <span class="text-muted-foreground">变动</span>
        <span
          class="font-mono font-semibold"
          :class="hoveredPoint.point.delta >= 0 ? 'text-emerald-600' : 'text-red-500'"
        >
          {{ hoveredPoint.point.delta >= 0 ? '+' : '' }}{{ hoveredPoint.point.delta.toLocaleString() }}
        </span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-muted-foreground">余额</span>
        <span class="font-mono">
          {{ hoveredPoint.point.balance === null ? '-' : hoveredPoint.point.balance.toLocaleString() }}
        </span>
      </div>
      <div class="mt-1 border-t pt-1 text-muted-foreground">
        {{ hoveredPoint.point.source || '-' }}
      </div>
    </div>
  </Teleport>
</template>
