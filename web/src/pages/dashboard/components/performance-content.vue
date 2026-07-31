/**
 * MIT License
 *
 * Copyright (c) 2026 LCH0426
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

<script lang="ts" setup>
import { ActivityIcon, CpuIcon, HardDriveIcon, LayersIcon, MemoryStickIcon, WifiIcon } from '@lucide/vue'
import { VisArea, VisAxis, VisLine, VisXYContainer } from '@unovis/vue'

import type { ChartConfig } from '@/components/ui/chart'
import type { ISystemStats } from '@/services/api/system.api'

import { useBackupApi } from '@/services/api/backup.api'
import { useSystemApi } from '@/services/api/system.api'

type MetricType = 'cpu' | 'memory' | 'network' | 'tps'
type CpuViewMode = 'overall' | 'perCore'

const MAX_POINTS = 60
const CIRCUMFERENCE = 2 * Math.PI * 40
const MIN_SEGMENT_RATIO = 0.005

function getUsageColor(usage: number): string {
  const t = Math.min(100, Math.max(0, usage)) / 100
  if (t <= 0.5) {
    const r = Math.round(59 + (245 - 59) * (t / 0.5))
    const g = Math.round(130 + (158 - 130) * (t / 0.5))
    const b = Math.round(246 + (11 - 246) * (t / 0.5))
    return `rgb(${r},${g},${b})`
  }
  else {
    const r = Math.round(245 + (239 - 245) * ((t - 0.5) / 0.5))
    const g = Math.round(158 + (68 - 158) * ((t - 0.5) / 0.5))
    const b = Math.round(11 + (68 - 11) * ((t - 0.5) / 0.5))
    return `rgb(${r},${g},${b})`
  }
}

const { getSystemStats, getTpsInfo } = useSystemApi()

const selectedMetric = ref<MetricType>('cpu')
const cpuViewMode = ref<CpuViewMode>('overall')

const metricOptions: { value: MetricType, label: string, icon: any }[] = [
  { value: 'cpu', label: 'CPU 使用率', icon: CpuIcon },
  { value: 'memory', label: '内存使用率', icon: MemoryStickIcon },
  { value: 'network', label: '网络吞吐量', icon: WifiIcon },
  { value: 'tps', label: '每秒事务数', icon: ActivityIcon },
]

interface DataPoint {
  index: number
  value: number
  upload?: number
  download?: number
  bdsMemory?: number
}

function createInitialData(): DataPoint[] {
  return Array.from({ length: MAX_POINTS }, (_, i) => ({
    index: i,
    value: 0,
    upload: 0,
    download: 0,
    bdsMemory: 0,
  }))
}

const cpuHistory = ref<DataPoint[]>(createInitialData())
const memoryHistory = ref<DataPoint[]>(createInitialData())
const networkHistory = ref<DataPoint[]>(createInitialData())
const tpsHistory = ref<DataPoint[]>(createInitialData())
const currentIndex = ref(MAX_POINTS)
const stats = ref<ISystemStats | null>(null)
const currentTps = ref<string>('--')
const backupSizeGB = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)
const hoveredSegment = ref<number | null>(null)

const chartConfig = {
  value: {
    label: '使用率',
    color: 'var(--chart-4)',
  },
  upload: {
    label: '上传',
    color: 'var(--chart-2)',
  },
  download: {
    label: '下载',
    color: 'var(--chart-1)',
  },
  tps: {
    label: 'TPS',
    color: 'var(--chart-3)',
  },
  bdsMemory: {
    label: 'BDS内存',
    color: 'var(--chart-1)',
  },
} satisfies ChartConfig

const coreCount = computed(() => stats.value?.cpu.cores ?? 1)

const currentChartData = computed(() => {
  if (selectedMetric.value === 'cpu')
    return cpuHistory.value
  if (selectedMetric.value === 'memory')
    return memoryHistory.value
  if (selectedMetric.value === 'network')
    return networkHistory.value
  return tpsHistory.value
})

const currentLabel = computed(() => {
  const opt = metricOptions.find(o => o.value === selectedMetric.value)
  return opt?.label || ''
})

const currentValue = computed(() => {
  if (!stats.value && selectedMetric.value !== 'tps')
    return '--'
  if (selectedMetric.value === 'cpu')
    return `${stats.value!.cpu.usage.toFixed(1)}%`
  if (selectedMetric.value === 'memory') {
    const bdsMemMB = (stats.value as any)?.bdsmemory || 0
    return `${stats.value!.memory.usagePercent.toFixed(1)}% | BDS: ${bdsMemMB} MB`
  }
  if (selectedMetric.value === 'network') {
    const up = stats.value!.network.uploadThroughput.toFixed(2)
    const down = stats.value!.network.downloadThroughput.toFixed(2)
    return `↑${up} ↓${down} Mbps`
  }
  return `TPS: ${currentTps.value}`
})

const diskData = computed(() => {
  if (!stats.value)
    return null
  const total = stats.value.disk.total
  const worldSize = stats.value.worldSize
  const backupSize = backupSizeGB.value
  const used = stats.value.disk.used
  const otherUsed = used - worldSize - backupSize
  const free = stats.value.disk.free
  return {
    total,
    used,
    worldSize,
    backupSize,
    otherUsed,
    free,
    usagePercent: stats.value.disk.usagePercent,
  }
})

const diskSegments = computed(() => {
  if (!diskData.value)
    return []
  const d = diskData.value
  return [
    { label: '已利用', value: d.otherUsed, color: '#22c55e' },
    { label: '存档占用', value: d.worldSize, color: '#eab308' },
    { label: '备份占用', value: d.backupSize, color: '#3b82f6' },
    { label: '可用', value: d.free, color: '#9ca3af' },
  ]
})

function getSegmentDash(value: number, total: number) {
  const ratio = value / total
  const clampedRatio = Math.max(ratio, MIN_SEGMENT_RATIO)
  const dashLength = clampedRatio * CIRCUMFERENCE
  return `${dashLength} ${CIRCUMFERENCE}`
}

function getSegmentOffset(index: number) {
  if (!diskData.value)
    return '0'
  let offset = 0
  for (let i = 0; i < index; i++) {
    const seg = diskSegments.value[i]
    const ratio = seg.value / diskData.value.total
    const clampedRatio = Math.max(ratio, MIN_SEGMENT_RATIO)
    offset += clampedRatio * CIRCUMFERENCE
  }
  return `${-offset}`
}

const hoveredInfo = computed(() => {
  if (hoveredSegment.value === null || !diskSegments.value[hoveredSegment.value] || !diskData.value)
    return null
  const seg = diskSegments.value[hoveredSegment.value]
  const percent = ((seg.value / diskData.value.total) * 100).toFixed(1)
  return {
    label: seg.label,
    value: seg.value.toFixed(1),
    percent,
    color: seg.color,
  }
})

// 缓存 yDomain 数组引用，避免每次渲染创建新数组导致图表重绘
const cachedYDomain = {
  cpu: [0, 100] as [number, number],
  tps: [0, 20] as [number, number],
  network: [0, 0.1] as [number, number],
  memory: [0, 100] as [number, number],
}

const currentYDomain = computed(() => {
  if (selectedMetric.value === 'network') {
    let maxVal = 0
    for (const d of networkHistory.value) {
      const m = Math.max(d.upload ?? 0, d.download ?? 0)
      if (m > maxVal)
        maxVal = m
    }
    const maxY = Math.ceil(maxVal * 1.2 * 10) / 10
    cachedYDomain.network[0] = 0
    cachedYDomain.network[1] = Math.max(maxY, 0.1)
    return cachedYDomain.network
  }
  if (selectedMetric.value === 'memory')
    return cachedYDomain.memory
  if (selectedMetric.value === 'tps')
    return cachedYDomain.tps
  return cachedYDomain.cpu
})

function addDataPoint(history: Ref<DataPoint[]>, value: number, upload?: number, download?: number, bdsMemory?: number) {
  history.value.push({ index: currentIndex.value, value, upload, download, bdsMemory })
  if (history.value.length > MAX_POINTS)
    history.value.shift()
}

async function fetchStats() {
  try {
    const promises: Promise<any>[] = [getSystemStats()]
    if (selectedMetric.value === 'tps')
      promises.push(getTpsInfo())

    const results = await Promise.all(promises)
    const statsRes = results[0]

    if (statsRes.code === 200) {
      stats.value = statsRes.data
      addDataPoint(cpuHistory, statsRes.data.cpu.usage)
      // BDS 内存（计算占总内存的百分比）
      const bdsMemoryMB = (statsRes.data as any).bdsmemory || 0
      const totalMemoryMB = statsRes.data.memory.total * 1024
      const bdsMemoryPercent = totalMemoryMB > 0 ? (bdsMemoryMB / totalMemoryMB) * 100 : 0
      addDataPoint(memoryHistory, statsRes.data.memory.usagePercent, undefined, undefined, bdsMemoryPercent)
      const upload = Number(statsRes.data.network.uploadThroughput.toFixed(2))
      const download = Number(statsRes.data.network.downloadThroughput.toFixed(2))
      addDataPoint(networkHistory, download, upload, download)
      error.value = null
    }
    else {
      error.value = statsRes.msg || '获取系统数据失败'
    }

    if (selectedMetric.value === 'tps' && results[1]?.code === 200) {
      currentTps.value = results[1].data.tps
      const tpsVal = Number.parseFloat(results[1].data.tps)
      if (!Number.isNaN(tpsVal))
        addDataPoint(tpsHistory, tpsVal)
    }

    currentIndex.value++
  }
  catch {
    error.value = '无法连接到服务器'
  }
  finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null

async function fetchBackupStats() {
  const { getBackupStats } = useBackupApi()
  try {
    const res = await getBackupStats()
    if (res.code === 200)
      backupSizeGB.value = res.data.totalSize / (1024 * 1024 * 1024)
  }
  catch {}
}

onMounted(async () => {
  // 先获取几次数据填充图表
  await fetchStats()
  await fetchStats()
  await fetchStats()
  fetchBackupStats()
  timer = setInterval(fetchStats, 3000)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<template>
  <div v-if="loading && !stats" class="flex items-center justify-center py-20">
    <UiSpinner class="size-6" />
  </div>

  <div v-else class="space-y-4">
    <div v-if="error && !stats" class="text-center text-muted-foreground py-10">
      {{ error }}
    </div>

    <template v-if="stats">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <UiCard>
          <UiCardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
            <UiCardTitle class="text-sm font-medium">
              CPU
            </UiCardTitle>
            <CpuIcon class="size-4 text-muted-foreground" />
          </UiCardHeader>
          <UiCardContent>
            <div class="text-2xl font-bold">
              {{ stats.cpu.usage.toFixed(1) }}%
            </div>
            <p class="text-xs text-muted-foreground">
              {{ stats.cpu.model }}
            </p>
          </UiCardContent>
        </UiCard>
        <UiCard>
          <UiCardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
            <UiCardTitle class="text-sm font-medium">
              内存
            </UiCardTitle>
            <MemoryStickIcon class="size-4 text-muted-foreground" />
          </UiCardHeader>
          <UiCardContent>
            <div class="text-2xl font-bold">
              {{ stats.memory.usagePercent.toFixed(1) }}%
            </div>
            <p class="text-xs text-muted-foreground">
              {{ stats.memory.used.toFixed(1) }} / {{ stats.memory.total.toFixed(1) }} GB
            </p>
          </UiCardContent>
        </UiCard>
        <UiCard>
          <UiCardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
            <UiCardTitle class="text-sm font-medium">
              网络
            </UiCardTitle>
            <WifiIcon class="size-4 text-muted-foreground" />
          </UiCardHeader>
          <UiCardContent>
            <div class="text-2xl font-bold">
              ↑{{ stats.network.uploadThroughput.toFixed(2) }} ↓{{ stats.network.downloadThroughput.toFixed(2) }}
            </div>
            <p class="text-xs text-muted-foreground">
              Mbps
            </p>
          </UiCardContent>
        </UiCard>
        <UiCard>
          <UiCardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
            <UiCardTitle class="text-sm font-medium">
              磁盘
            </UiCardTitle>
            <HardDriveIcon class="size-4 text-muted-foreground" />
          </UiCardHeader>
          <UiCardContent>
            <div class="text-2xl font-bold">
              {{ stats.disk.usagePercent.toFixed(1) }}%
            </div>
            <p class="text-xs text-muted-foreground">
              {{ stats.disk.used.toFixed(1) }} / {{ stats.disk.total.toFixed(1) }} GB
            </p>
          </UiCardContent>
        </UiCard>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-7">
        <UiCard class="col-span-1 lg:col-span-4 pt-0">
          <UiCardHeader class="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
            <div class="grid flex-1 gap-1">
              <UiCardTitle>性能监视表</UiCardTitle>
              <UiCardDescription>
                {{ currentLabel }}: {{ currentValue }}
              </UiCardDescription>
            </div>
            <div class="flex items-center gap-2">
              <UiTooltipProvider>
                <UiTooltip>
                  <UiTooltipTrigger as-child>
                    <UiButton
                      v-if="selectedMetric === 'cpu'"
                      variant="outline"
                      size="icon"
                      class="size-8"
                      :class="cpuViewMode === 'perCore' ? 'bg-primary/10 border-primary/50' : ''"
                      @click="cpuViewMode = cpuViewMode === 'overall' ? 'perCore' : 'overall'"
                    >
                      <LayersIcon class="size-4" />
                    </UiButton>
                  </UiTooltipTrigger>
                  <UiTooltipContent>
                    <p>{{ cpuViewMode === 'overall' ? '切换到每核视图' : '切换到总体视图' }}</p>
                  </UiTooltipContent>
                </UiTooltip>
              </UiTooltipProvider>
              <UiDropdownMenu>
                <UiDropdownMenuTrigger as-child>
                  <UiButton variant="outline" size="sm" class="ml-auto">
                    <component :is="metricOptions.find(o => o.value === selectedMetric)?.icon" class="size-4 mr-1" />
                    {{ currentLabel }}
                    <ChevronsUpDownIcon class="size-4 ml-1" />
                  </UiButton>
                </UiDropdownMenuTrigger>
                <UiDropdownMenuContent align="end">
                  <UiDropdownMenuItem
                    v-for="opt in metricOptions"
                    :key="opt.value"
                    @click="selectedMetric = opt.value"
                  >
                    <component :is="opt.icon" class="size-4 mr-2" />
                    {{ opt.label }}
                  </UiDropdownMenuItem>
                </UiDropdownMenuContent>
              </UiDropdownMenu>
            </div>
          </UiCardHeader>
          <UiCardContent class="px-2 pt-4 sm:px-6 sm:pt-6 pb-4">
            <template v-if="selectedMetric === 'cpu' && cpuViewMode === 'perCore'">
              <div class="h-[250px] w-full rounded-md bg-muted/40 p-2 overflow-hidden">
                <div class="grid gap-1 h-full auto-rows-fr" :style="{ gridTemplateColumns: `repeat(${Math.min(coreCount, 8)}, 1fr)` }">
                  <div
                    v-for="(_, coreIdx) in coreCount"
                    :key="coreIdx"
                    class="relative rounded border flex flex-col items-center justify-center min-h-0 transition-colors duration-500"
                    :style="{ backgroundColor: `${getUsageColor(stats?.cpu.perCore?.usage?.[coreIdx] ?? 0)}30`, borderColor: `${getUsageColor(stats?.cpu.perCore?.usage?.[coreIdx] ?? 0)}60` }"
                  >
                    <span class="text-[10px] font-medium leading-none" :style="{ color: getUsageColor(stats?.cpu.perCore?.usage?.[coreIdx] ?? 0) }">CPU {{ coreIdx }}</span>
                    <span class="text-sm font-bold leading-tight mt-0.5" :style="{ color: getUsageColor(stats?.cpu.perCore?.usage?.[coreIdx] ?? 0) }">{{ (stats?.cpu.perCore?.usage?.[coreIdx] ?? 0).toFixed(0) }}%</span>
                  </div>
                </div>
              </div>
            </template>
            <template v-else>
              <ChartContainer :config="chartConfig" class="aspect-auto h-[250px] w-full rounded-md bg-muted/40" :cursor="false">
                <VisXYContainer
                  :data="currentChartData"
                  :margin="{ left: 40, right: 0, top: 10, bottom: 20 }"
                  :y-domain="currentYDomain"
                >
                  <template v-if="selectedMetric === 'network'">
                    <VisLine
                      :x="(d: DataPoint) => d.index"
                      :y="(d: DataPoint) => d.upload!"
                      :color="chartConfig.upload.color"
                      :line-width="1"
                      class="upload-line"
                    />
                    <VisLine
                      :x="(d: DataPoint) => d.index"
                      :y="(d: DataPoint) => d.download!"
                      :color="chartConfig.download.color"
                      :line-width="1"
                    />
                  </template>
                  <template v-else-if="selectedMetric === 'memory'">
                    <VisArea
                      :x="(d: DataPoint) => d.index"
                      :y="(d: DataPoint) => d.value"
                      :color="chartConfig.value.color"
                      :opacity="0.15"
                    />
                    <VisArea
                      :x="(d: DataPoint) => d.index"
                      :y="(d: DataPoint) => d.bdsMemory ?? 0"
                      :color="chartConfig.bdsMemory.color"
                      :opacity="0.15"
                    />
                    <VisLine
                      :x="(d: DataPoint) => d.index"
                      :y="(d: DataPoint) => d.value"
                      :color="chartConfig.value.color"
                      :line-width="1.5"
                    />
                    <VisLine
                      :x="(d: DataPoint) => d.index"
                      :y="(d: DataPoint) => d.bdsMemory ?? 0"
                      :color="chartConfig.bdsMemory.color"
                      :line-width="1.5"
                    />
                  </template>
                  <template v-else>
                    <VisLine
                      :x="(d: DataPoint) => d.index"
                      :y="(d: DataPoint) => d.value"
                      :color="selectedMetric === 'tps' ? chartConfig.tps.color : chartConfig.value.color"
                      :line-width="1"
                    />
                  </template>
                  <VisAxis
                    type="x"
                    :num-ticks="6"
                    :tick-line="false"
                    :domain-line="false"
                    :grid-line="false"
                    :tick-format="() => ''"
                  />
                  <VisAxis
                    type="y"
                    :num-ticks="5"
                    :tick-line="false"
                    :domain-line="false"
                    :tick-format="(v: number) => selectedMetric === 'network' ? `${v}` : selectedMetric === 'tps' ? `${v}` : `${v}%`"
                  />
                </VisXYContainer>
              </ChartContainer>
              <div v-if="selectedMetric === 'network'" class="flex items-center justify-center gap-6 mt-3 text-sm">
                <div class="flex items-center gap-2">
                  <div class="size-3 rounded-sm" style="background-color: var(--chart-2)" />
                  <span class="text-muted-foreground">上传</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="size-3 rounded-sm" style="background-color: var(--chart-1)" />
                  <span class="text-muted-foreground">下载</span>
                </div>
              </div>
              <div v-if="selectedMetric === 'memory'" class="flex items-center justify-center gap-6 mt-3 text-sm">
                <div class="flex items-center gap-2">
                  <div class="size-3 rounded-sm" style="background-color: var(--chart-1)" />
                  <span class="text-muted-foreground">系统内存</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="size-3 rounded-sm border-2" style="background-color: var(--chart-4)" />
                  <span class="text-muted-foreground">BDS 内存</span>
                </div>
              </div>
            </template>
          </UiCardContent>
        </UiCard>

        <UiCard class="col-span-1 lg:col-span-3">
          <UiCardHeader>
            <UiCardTitle>存储概览</UiCardTitle>
            <UiCardDescription>
              总存储: {{ diskData?.total.toFixed(1) }} GB
            </UiCardDescription>
          </UiCardHeader>
          <UiCardContent class="flex flex-col items-center gap-4">
            <div class="relative size-48">
              <svg viewBox="0 0 100 100" class="size-full -rotate-90">
                <template v-if="diskData">
                  <circle
                    cx="50" cy="50" r="40"
                    fill="none"
                    stroke="#9ca3af"
                    stroke-width="12"
                  />
                  <circle
                    v-for="(seg, i) in diskSegments"
                    :key="i"
                    cx="50" cy="50" r="40"
                    fill="none"
                    :stroke="seg.color"
                    stroke-width="12"
                    :stroke-dasharray="getSegmentDash(seg.value, diskData!.total)"
                    :stroke-dashoffset="getSegmentOffset(i)"
                    class="cursor-pointer transition-opacity duration-150"
                    :class="hoveredSegment !== null && hoveredSegment !== i ? 'opacity-40' : 'opacity-100'"
                    @mouseenter="hoveredSegment = i"
                    @mouseleave="hoveredSegment = null"
                  />
                </template>
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <template v-if="hoveredInfo">
                  <span class="text-lg font-bold">{{ hoveredInfo.label }}</span>
                  <span class="text-sm text-muted-foreground">{{ hoveredInfo.value }} GB ({{ hoveredInfo.percent }}%)</span>
                </template>
                <template v-else>
                  <span class="text-2xl font-bold">{{ diskData?.usagePercent.toFixed(1) }}%</span>
                  <span class="text-xs text-muted-foreground">已使用</span>
                </template>
              </div>
            </div>
            <div class="grid grid-cols-1 gap-2 w-full text-sm">
              <div
                v-for="(seg, i) in diskSegments"
                :key="seg.label"
                class="flex items-center justify-between cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-muted/50"
                :class="hoveredSegment === i ? 'bg-muted/50' : ''"
                @mouseenter="hoveredSegment = i"
                @mouseleave="hoveredSegment = null"
              >
                <div class="flex items-center gap-2">
                  <div class="size-3 rounded-full" :style="{ backgroundColor: seg.color }" />
                  <span>{{ seg.label }}</span>
                </div>
                <span class="text-muted-foreground">{{ seg.value.toFixed(1) }} GB</span>
              </div>
            </div>
          </UiCardContent>
        </UiCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.upload-line :deep(path) {
  stroke-dasharray: 6 4;
}
</style>
