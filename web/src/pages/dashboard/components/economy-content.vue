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
import type { IEconomyRankData } from '@/services/api/economy.api'

import { useEconomyApi } from '@/services/api/economy.api'
import { usePlayerApi } from '@/services/api/player.api'

const CIRCUMFERENCE = 2 * Math.PI * 40
const MIN_SEGMENT_RATIO = 0.005

const CHART_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444']
const OTHER_COLOR = '#9ca3af'

const { getEconomyRank } = useEconomyApi()
const { getAllMoney } = usePlayerApi()

const data = ref<IEconomyRankData | null>(null)
const totalMoney = ref<number>(0)
const loading = ref(true)
const hoveredBalanceSegment = ref<number | null>(null)
const hoveredBankSegment = ref<number | null>(null)

function formatNumber(n: number): string {
  return n.toLocaleString()
}

const balanceSegments = computed(() => {
  if (!data.value)
    return []
  const topTotal = data.value.topBalances.reduce((s, p) => s + p.balance, 0)
  const otherVal = totalMoney.value - topTotal
  const segments = data.value.topBalances.map((p, i) => ({
    label: p.name,
    value: p.balance,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }))
  if (otherVal > 0) {
    segments.push({ label: '其他', value: otherVal, color: OTHER_COLOR })
  }
  return segments
})

const balanceTotal = computed(() => {
  if (!data.value)
    return 0
  return Math.max(totalMoney.value, data.value.topBalances.reduce((s, p) => s + p.balance, 0))
})

const bankPlayerSegments = computed(() => {
  if (!data.value)
    return []
  const topTotal = data.value.topBankDeposits.reduce((s, p) => s + p.bankTotal, 0)
  const otherTotal = data.value.totalBankAll - topTotal
  const segments = data.value.topBankDeposits.map((p, i) => ({
    label: p.name,
    value: p.bankTotal,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }))
  if (otherTotal > 0) {
    segments.push({ label: '其他', value: otherTotal, color: OTHER_COLOR })
  }
  return segments
})

const bankBarData = computed(() => {
  if (!data.value)
    return null
  const total = data.value.totalBankAll || 1
  return {
    currentPercent: (data.value.totalBankCurrent / total * 100).toFixed(1),
    fixedPercent: (data.value.totalBankFixed / total * 100).toFixed(1),
    current: data.value.totalBankCurrent,
    fixed: data.value.totalBankFixed,
    total: data.value.totalBankAll,
  }
})

function getSegmentDash(value: number, total: number) {
  const ratio = value / total
  const clampedRatio = Math.max(ratio, MIN_SEGMENT_RATIO)
  const dashLength = clampedRatio * CIRCUMFERENCE
  return `${dashLength} ${CIRCUMFERENCE}`
}

function getSegmentOffset(segments: { value: number }[], index: number, total: number) {
  let offset = 0
  for (let i = 0; i < index; i++) {
    const ratio = segments[i].value / total
    const clampedRatio = Math.max(ratio, MIN_SEGMENT_RATIO)
    offset += clampedRatio * CIRCUMFERENCE
  }
  return `${-offset}`
}

const hoveredBalanceInfo = computed(() => {
  if (hoveredBalanceSegment.value === null || !balanceSegments.value[hoveredBalanceSegment.value] || !data.value)
    return null
  const seg = balanceSegments.value[hoveredBalanceSegment.value]
  const percent = ((seg.value / balanceTotal.value) * 100).toFixed(1)
  return {
    label: seg.label,
    value: formatNumber(seg.value),
    percent,
    color: seg.color,
  }
})

const hoveredBankInfo = computed(() => {
  if (hoveredBankSegment.value === null || !bankPlayerSegments.value[hoveredBankSegment.value] || !data.value)
    return null
  const seg = bankPlayerSegments.value[hoveredBankSegment.value]
  const percent = ((seg.value / data.value.totalBankAll) * 100).toFixed(1)
  return {
    label: seg.label,
    value: formatNumber(seg.value),
    percent,
    color: seg.color,
  }
})

async function fetchData() {
  loading.value = true
  try {
    const [rankRes, moneyRes] = await Promise.all([
      getEconomyRank(),
      getAllMoney(),
    ])
    if (rankRes.code === 200)
      data.value = rankRes.data
    if (moneyRes.code === 200)
      totalMoney.value = moneyRes.data.totalMoney
  }
  catch {}
  finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  fetchData()
  timer = setInterval(fetchData, 300000)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<template>
  <div v-if="loading && !data" class="flex items-center justify-center py-20">
    <UiSpinner class="size-6" />
  </div>

  <div v-else-if="data" class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <UiCard>
      <UiCardHeader>
        <UiCardTitle>经济排行</UiCardTitle>
        <UiCardDescription>
          前5名玩家余额分布
        </UiCardDescription>
      </UiCardHeader>
      <UiCardContent class="flex flex-col items-center gap-4">
        <div class="relative size-48">
          <svg viewBox="0 0 100 100" class="size-full -rotate-90">
            <circle
              cx="50" cy="50" r="40"
              fill="none"
              :stroke="OTHER_COLOR"
              stroke-width="12"
              opacity="0.2"
            />
            <circle
              v-for="(seg, i) in balanceSegments"
              :key="i"
              cx="50" cy="50" r="40"
              fill="none"
              :stroke="seg.color"
              stroke-width="12"
              :stroke-dasharray="getSegmentDash(seg.value, balanceTotal)"
              :stroke-dashoffset="getSegmentOffset(balanceSegments, i, balanceTotal)"
              class="cursor-pointer transition-opacity duration-150"
              :class="hoveredBalanceSegment !== null && hoveredBalanceSegment !== i ? 'opacity-40' : 'opacity-100'"
              @mouseenter="hoveredBalanceSegment = i"
              @mouseleave="hoveredBalanceSegment = null"
            />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <template v-if="hoveredBalanceInfo">
              <span class="text-sm font-bold" :style="{ color: hoveredBalanceInfo.color }">{{ hoveredBalanceInfo.label }}</span>
              <span class="text-xs text-muted-foreground">{{ hoveredBalanceInfo.value }} ({{ hoveredBalanceInfo.percent }}%)</span>
            </template>
            <template v-else>
              <span class="text-lg font-bold">{{ formatNumber(balanceTotal) }}</span>
              <span class="text-xs text-muted-foreground">全服总额</span>
            </template>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-1.5 w-full text-sm">
          <div
            v-for="(seg, i) in balanceSegments"
            :key="seg.label"
            class="flex items-center justify-between cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-muted/50"
            :class="hoveredBalanceSegment === i ? 'bg-muted/50' : ''"
            @mouseenter="hoveredBalanceSegment = i"
            @mouseleave="hoveredBalanceSegment = null"
          >
            <div class="flex items-center gap-2">
              <div class="size-3 rounded-full" :style="{ backgroundColor: seg.color }" />
              <span>{{ seg.label }}</span>
            </div>
            <span class="text-muted-foreground font-mono">{{ formatNumber(seg.value) }}</span>
          </div>
        </div>
      </UiCardContent>
    </UiCard>

    <UiCard>
      <UiCardHeader>
        <UiCardTitle>银行经济</UiCardTitle>
        <UiCardDescription>
          全服银行存款统计
        </UiCardDescription>
      </UiCardHeader>
      <UiCardContent class="flex flex-col items-center gap-4">
        <div class="relative size-48">
          <svg viewBox="0 0 100 100" class="size-full -rotate-90">
            <circle
              cx="50" cy="50" r="40"
              fill="none"
              :stroke="OTHER_COLOR"
              stroke-width="12"
              opacity="0.2"
            />
            <circle
              v-for="(seg, i) in bankPlayerSegments"
              :key="i"
              cx="50" cy="50" r="40"
              fill="none"
              :stroke="seg.color"
              stroke-width="12"
              :stroke-dasharray="getSegmentDash(seg.value, data.totalBankAll)"
              :stroke-dashoffset="getSegmentOffset(bankPlayerSegments, i, data.totalBankAll)"
              class="cursor-pointer transition-opacity duration-150"
              :class="hoveredBankSegment !== null && hoveredBankSegment !== i ? 'opacity-40' : 'opacity-100'"
              @mouseenter="hoveredBankSegment = i"
              @mouseleave="hoveredBankSegment = null"
            />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <template v-if="hoveredBankInfo">
              <span class="text-sm font-bold" :style="{ color: hoveredBankInfo.color }">{{ hoveredBankInfo.label }}</span>
              <span class="text-xs text-muted-foreground">{{ hoveredBankInfo.value }} ({{ hoveredBankInfo.percent }}%)</span>
            </template>
            <template v-else>
              <span class="text-lg font-bold">{{ formatNumber(data.totalBankAll) }}</span>
              <span class="text-xs text-muted-foreground">银行总额</span>
            </template>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-1.5 w-full text-sm">
          <div
            v-for="(seg, i) in bankPlayerSegments"
            :key="seg.label"
            class="flex items-center justify-between cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-muted/50"
            :class="hoveredBankSegment === i ? 'bg-muted/50' : ''"
            @mouseenter="hoveredBankSegment = i"
            @mouseleave="hoveredBankSegment = null"
          >
            <div class="flex items-center gap-2">
              <div class="size-3 rounded-full" :style="{ backgroundColor: seg.color }" />
              <span>{{ seg.label }}</span>
            </div>
            <span class="text-muted-foreground font-mono">{{ formatNumber(seg.value) }}</span>
          </div>
        </div>

        <UiSeparator class="my-1" />

        <div v-if="bankBarData" class="w-full space-y-2">
          <div class="text-sm font-medium">
            存款类型分布
          </div>
          <div class="space-y-1">
            <div class="h-4 w-full rounded-full bg-muted overflow-hidden flex">
              <div
                class="h-full transition-all duration-500 rounded-l-full"
                style="background-color: #3b82f6"
                :style="{ width: `${bankBarData.currentPercent}%` }"
              />
              <div
                class="h-full transition-all duration-500 rounded-r-full"
                style="background-color: #22c55e"
                :style="{ width: `${bankBarData.fixedPercent}%` }"
              />
            </div>
            <div class="flex items-center justify-between text-xs text-muted-foreground">
              <div class="flex items-center gap-1.5">
                <div class="size-2.5 rounded-sm" style="background-color: #3b82f6" />
                <span>活期 {{ formatNumber(bankBarData.current) }} ({{ bankBarData.currentPercent }}%)</span>
              </div>
              <div class="flex items-center gap-1.5">
                <div class="size-2.5 rounded-sm" style="background-color: #22c55e" />
                <span>定期 {{ formatNumber(bankBarData.fixed) }} ({{ bankBarData.fixedPercent }}%)</span>
              </div>
            </div>
          </div>
        </div>
      </UiCardContent>
    </UiCard>
  </div>
</template>
