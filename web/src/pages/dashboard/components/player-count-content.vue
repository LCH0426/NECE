<script lang="ts" setup>
import { UsersIcon } from '@lucide/vue'
import { VisArea, VisAxis, VisLine, VisXYContainer } from '@unovis/vue'

import type { ChartConfig } from '@/components/ui/chart'
import type { IPlayerCountData, IPlayerCountRecord } from '@/services/api/system.api'

import { useSystemApi } from '@/services/api/system.api'

type TrendRange = '1h' | '6h' | '24h' | '7d'

const { getPlayerCount, getPlayerCountTrend } = useSystemApi()

const countData = ref<IPlayerCountData | null>(null)
const trendRecords = ref<IPlayerCountRecord[]>([])
const selectedRange = ref<TrendRange>('24h')
const loading = ref(true)
const error = ref<string | null>(null)

const rangeOptions: { value: TrendRange, label: string }[] = [
  { value: '1h', label: '1小时' },
  { value: '6h', label: '6小时' },
  { value: '24h', label: '24小时' },
  { value: '7d', label: '7天' },
]

interface DataPoint {
  index: number
  value: number
  timestamp: number
}

const chartData = computed<DataPoint[]>(() => {
  return trendRecords.value.map((r, i) => ({
    index: i,
    value: r.count,
    timestamp: r.timestamp,
  }))
})

const maxY = computed(() => {
  if (trendRecords.value.length === 0)
    return 10
  const maxVal = Math.max(...trendRecords.value.map(r => r.count), 1)
  return Math.ceil(maxVal * 1.2)
})

const chartConfig = {
  value: {
    label: '在线人数',
    color: 'var(--chart-1)',
  },
} satisfies ChartConfig

function formatTimestamp(ts: number): string {
  const date = new Date(ts * 1000)
  if (selectedRange.value === '7d') {
    return `${date.getMonth() + 1}/${date.getDate()}`
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function tickFormat(i: number) {
  const record = trendRecords.value[i as number]
  if (!record)
    return ''
  const total = trendRecords.value.length
  if (total <= 6)
    return formatTimestamp(record.timestamp)
  const step = Math.floor(total / 6)
  if (i % step === 0)
    return formatTimestamp(record.timestamp)
  return ''
}

async function fetchData() {
  try {
    const [countRes, trendRes] = await Promise.all([
      getPlayerCount(),
      getPlayerCountTrend(selectedRange.value),
    ])
    if (countRes.code === 200)
      countData.value = countRes.data
    if (trendRes.code === 200)
      trendRecords.value = trendRes.data.records
    error.value = null
  }
  catch {
    error.value = '获取数据失败'
  }
  finally {
    loading.value = false
  }
}

watch(selectedRange, () => {
  loading.value = true
  fetchData()
})

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  fetchData()
  timer = setInterval(fetchData, 30000)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<template>
  <div v-if="loading && !countData" class="flex items-center justify-center py-20">
    <UiSpinner class="size-6" />
  </div>

  <div v-else-if="error && !countData" class="text-center text-muted-foreground py-10">
    {{ error }}
  </div>

  <div v-else class="space-y-4">
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UiCard>
        <UiCardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
          <UiCardTitle class="text-sm font-medium">
            当前在线
          </UiCardTitle>
          <UsersIcon class="size-4 text-muted-foreground" />
        </UiCardHeader>
        <UiCardContent>
          <div class="text-2xl font-bold">
            {{ countData?.current ?? 0 }}
          </div>
          <p class="text-xs text-muted-foreground">
            名玩家在线
          </p>
        </UiCardContent>
      </UiCard>
      <UiCard>
        <UiCardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
          <UiCardTitle class="text-sm font-medium">
            今日峰值
          </UiCardTitle>
          <UsersIcon class="size-4 text-muted-foreground" />
        </UiCardHeader>
        <UiCardContent>
          <div class="text-2xl font-bold">
            {{ countData?.todayMax ?? 0 }}
          </div>
          <p class="text-xs text-muted-foreground">
            人同时在线
          </p>
        </UiCardContent>
      </UiCard>
      <UiCard>
        <UiCardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
          <UiCardTitle class="text-sm font-medium">
            今日均值
          </UiCardTitle>
          <UsersIcon class="size-4 text-muted-foreground" />
        </UiCardHeader>
        <UiCardContent>
          <div class="text-2xl font-bold">
            {{ countData?.todayAvg?.toFixed(1) ?? '0' }}
          </div>
          <p class="text-xs text-muted-foreground">
            平均在线人数
          </p>
        </UiCardContent>
      </UiCard>
      <UiCard>
        <UiCardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
          <UiCardTitle class="text-sm font-medium">
            采样次数
          </UiCardTitle>
          <UsersIcon class="size-4 text-muted-foreground" />
        </UiCardHeader>
        <UiCardContent>
          <div class="text-2xl font-bold">
            {{ countData?.todayRecords ?? 0 }}
          </div>
          <p class="text-xs text-muted-foreground">
            今日已记录
          </p>
        </UiCardContent>
      </UiCard>
    </div>

    <UiCard class="pt-0">
      <UiCardHeader class="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div class="grid flex-1 gap-1">
          <UiCardTitle>在线人数趋势</UiCardTitle>
          <UiCardDescription>
            当前: {{ countData?.current ?? 0 }} 人 ·
            峰值: {{ trendRecords.length > 0 ? Math.max(...trendRecords.map(r => r.count)) : 0 }} 人
          </UiCardDescription>
        </div>
        <div class="flex items-center gap-1">
          <UiButton
            v-for="opt in rangeOptions"
            :key="opt.value"
            :variant="selectedRange === opt.value ? 'default' : 'outline'"
            size="sm"
            @click="selectedRange = opt.value"
          >
            {{ opt.label }}
          </UiButton>
        </div>
      </UiCardHeader>
      <UiCardContent class="px-2 pt-4 sm:px-6 sm:pt-6 pb-4">
        <div v-if="chartData.length === 0" class="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
          暂无趋势数据
        </div>
        <ChartContainer
          v-else
          :config="chartConfig"
          class="aspect-auto h-[300px] w-full rounded-md bg-muted/40"
          :cursor="false"
        >
          <VisXYContainer
            :data="chartData"
            :margin="{ left: 40, right: 10, top: 10, bottom: 20 }"
            :y-domain="[0, maxY]"
          >
            <VisArea
              :x="(d: DataPoint) => d.index"
              :y="(d: DataPoint) => d.value"
              color="var(--chart-1)"
              :opacity="0.15"
            />
            <VisLine
              :x="(d: DataPoint) => d.index"
              :y="(d: DataPoint) => d.value"
              color="var(--chart-1)"
              :line-width="1"
            />
            <VisAxis
              type="x"
              :num-ticks="6"
              :tick-line="false"
              :domain-line="false"
              :grid-line="false"
              :tick-format="tickFormat"
            />
            <VisAxis
              type="y"
              :num-ticks="5"
              :tick-line="false"
              :domain-line="false"
              :tick-format="(v: number) => `${v}`"
            />
          </VisXYContainer>
        </ChartContainer>
      </UiCardContent>
    </UiCard>
  </div>
</template>
