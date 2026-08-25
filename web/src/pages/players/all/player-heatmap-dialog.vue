<script setup lang="ts">
import { toast } from 'vue-sonner'

import type { IPlayer } from '@/services/api/player.api'
import type { IPlayTimeHeatmap } from '@/services/api/playtime.api'

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { usePlaytimeApi } from '@/services/api/playtime.api'

const props = defineProps<{ player: IPlayer }>()
const open = defineModel<boolean>('open', { default: false })

const { getPlayTimeHeatmap, postRandomAssign } = usePlaytimeApi()
const loading = ref(false)
const heatmap = ref<IPlayTimeHeatmap | null>(null)

const showAssignPanel = ref(false)
const assigning = ref(false)
const assignedOnce = ref(false)
const endType = ref<'last' | 'now' | 'custom'>('last')
const customEndDate = ref('')
const maxDate = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

async function fetchData() {
  loading.value = true
  heatmap.value = null
  try {
    const res = await getPlayTimeHeatmap({ xuid: props.player.xuid })
    if (res.code === 200) {
      heatmap.value = res.data
    }
    else {
      toast.error(res.msg || '获取热力图失败')
    }
  }
  catch (error: any) {
    toast.error(`获取热力图失败: ${error?.message || '网络错误'}`)
  }
  finally {
    loading.value = false
  }
}

watch(() => open.value, (v) => {
  if (v) {
    // 打开时重置分配状态，避免切换玩家后无法分配
    assignedOnce.value = false
    showAssignPanel.value = false
    customEndDate.value = ''
    endType.value = heatmap.value?.leavetime ? 'last' : 'now'
    fetchData()
  }
}, { immediate: true })

// 有最后登录时间时默认选最后登录时间
watch(() => heatmap.value?.leavetime, (lt) => {
  if (lt)
    endType.value = 'last'
})

function formatDateStr(s?: string) {
  if (!s)
    return ''
  const d = new Date(/^\d+$/.test(s) ? Number(s) : s.replace(/-/g, '/'))
  if (Number.isNaN(d.getTime()))
    return s
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function handleAssignClick() {
  if (assignedOnce.value) {
    toast.info('该玩家已完成随机分配')
    return
  }
  showAssignPanel.value = !showAssignPanel.value
}

async function handleAssign() {
  if (assigning.value)
    return
  assigning.value = true
  try {
    const res = await postRandomAssign({
      xuid: props.player.xuid,
      endType: endType.value,
      endDate: endType.value === 'custom' ? customEndDate.value : undefined,
    })
    if (res.code === 200) {
      toast.success(`随机分配完成，覆盖 ${res.data?.assigned ?? 0} 天`)
      assignedOnce.value = true
      showAssignPanel.value = false
      fetchData()
    }
    else {
      toast.error(res.msg || '随机分配失败')
    }
  }
  catch (error: any) {
    toast.error(`随机分配失败: ${error?.message || '网络错误'}`)
  }
  finally {
    assigning.value = false
  }
}

// ==================== 热力图计算 ====================

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

function formatTotal(seconds: number) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  if (d > 0)
    return `${d} 天 ${h} 小时`
  if (h > 0)
    return `${h} 小时`
  return `${Math.floor(seconds / 60)} 分钟`
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
  <UiDialog v-model:open="open">
    <UiDialogContent class="sm:max-w-[840px]">
      <UiDialogHeader>
        <UiDialogTitle>
          游戏时长热力图 - {{ player.name }}
        </UiDialogTitle>
        <UiDialogDescription>
          最近一年每日游戏时长，颜色越深时长越长
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-3 py-2">
        <div v-if="loading" class="flex items-center justify-center py-10">
          <UiSpinner class="size-6" />
        </div>

        <div v-else-if="!heatmap" class="text-center text-sm text-muted-foreground py-10">
          暂无数据
        </div>

        <template v-else>
          <div class="overflow-x-auto pb-1">
            <div class="mx-auto w-fit">
              <div class="flex items-center mb-1 ml-8">
                <div
                  class="grid gap-[2px] text-[10px] text-muted-foreground"
                  :style="{ gridTemplateRows: '14px', gridAutoFlow: 'column', gridAutoColumns: '10px' }"
                >
                  <template v-for="(_, col) in weeks" :key="col">
                    <span>{{ monthLabels.find(m => m.col === col)?.label || '' }}</span>
                  </template>
                </div>
              </div>

              <div class="flex">
                <div class="flex flex-col gap-[2px] mr-1 w-7 text-[10px] text-muted-foreground">
                  <span v-for="label in weekdayLabels" :key="label" class="h-[10px] leading-[10px]">
                    {{ label }}
                  </span>
                </div>

                <UiTooltipProvider :delay-duration="0" :skip-delay-duration="0">
                  <div
                    class="grid gap-[2px]"
                    :style="{ gridTemplateRows: 'repeat(7, 10px)', gridAutoFlow: 'column', gridAutoColumns: '10px' }"
                  >
                    <template v-for="(week, col) in weeks" :key="col">
                      <template v-for="(day, row) in week" :key="`${col}-${row}`">
                        <UiTooltip v-if="day">
                          <UiTooltipTrigger as-child>
                            <span
                              class="block size-[10px] rounded-[2px] cursor-pointer outline-none"
                              :style="{ backgroundColor: cellColor(day) }"
                            />
                          </UiTooltipTrigger>
                          <UiTooltipContent side="top" class="text-xs">
                            {{ cellTitle(day) }}
                          </UiTooltipContent>
                        </UiTooltip>
                        <span v-else class="size-[10px] rounded-[2px]" />
                      </template>
                    </template>
                  </div>
                </UiTooltipProvider>
              </div>

              <div class="flex items-center justify-end gap-1 mt-2 text-[10px] text-muted-foreground">
                <span>少</span>
                <span class="size-[10px] rounded-[2px]" style="background-color: var(--muted)" />
                <span
                  v-for="color in levelColors"
                  :key="color"
                  class="size-[10px] rounded-[2px]"
                  :style="{ backgroundColor: color }"
                />
                <span>多</span>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="space-y-0.5 rounded-md border p-3">
              <span class="text-xs text-muted-foreground">总游戏时长</span>
              <p class="font-mono">
                {{ formatTotal(heatmap.totalPlayTime) }}
              </p>
            </div>
            <div class="space-y-0.5 rounded-md border p-3">
              <span class="text-xs text-muted-foreground">活跃天数</span>
              <p class="font-mono">
                {{ heatmap.activeDays }} 天
              </p>
            </div>
          </div>
        </template>
      </div>

      <div class="rounded-md border p-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">
              随机分配游戏时长
            </p>
            <p class="text-xs text-muted-foreground">
              按注册日至所选结束时间分配总时长，周末偏高寒暑假除外，每天不超 8 小时
            </p>
          </div>
          <UiButton v-if="!assignedOnce" variant="outline" size="sm" :disabled="assigning" @click="handleAssignClick">
            {{ assigning ? '分配中...' : showAssignPanel ? '收起' : '随机分配' }}
          </UiButton>
          <UiButton v-else variant="outline" size="sm" disabled title="已完成分配">
            已随机分配
          </UiButton>
        </div>

        <div v-if="showAssignPanel && !assignedOnce" class="space-y-2 border-t pt-2">
          <RadioGroup v-model="endType" class="grid gap-1.5 text-sm">
            <label class="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="last" />
              最后登录时间
              <span v-if="heatmap?.leavetime" class="text-xs text-muted-foreground">{{ formatDateStr(heatmap.leavetime) }}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="now" />
              当前时间
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="custom" />
              自定义结束时间
            </label>
          </RadioGroup>
          <input
            v-if="endType === 'custom'"
            v-model="customEndDate"
            type="date"
            :max="maxDate"
            class="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          >
          <div class="flex justify-end gap-2">
            <UiButton variant="outline" size="sm" @click="showAssignPanel = false">
              取消
            </UiButton>
            <UiButton size="sm" :disabled="assigning || (endType === 'custom' && !customEndDate)" @click="handleAssign">
              开始分配
            </UiButton>
          </div>
        </div>
      </div>

      <UiDialogFooter>
        <UiButton variant="outline" @click="open = false">
          关闭
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
