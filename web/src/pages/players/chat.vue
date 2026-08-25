<script setup lang="ts">
import { RefreshCwIcon, SendIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IChatMessage } from '@/services/api/player.api'

import { BasicPage } from '@/components/global-layout'
import { usePlayerApi } from '@/services/api/player.api'

const { getChatHistory, getChatLog, getChatLogDates, sendChatMessage } = usePlayerApi()

const activeTab = ref<'realtime' | 'history'>('realtime')

const realtimeMessages = ref<IChatMessage[]>([])
const realtimeLoading = ref(false)
const realtimeTotal = ref(0)

const historyMessages = ref<IChatMessage[]>([])
const historyLoading = ref(false)
const historyPage = ref(1)
const historyPageSize = ref(50)
const historyTotal = ref(0)
const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const selectedDate = ref(todayStr)
const availableDates = ref<string[]>([])
const senderFilter = ref('')
const keywordFilter = ref('')

const sendMessage = ref('')
const sendLoading = ref(false)

async function fetchRealtime() {
  realtimeLoading.value = true
  try {
    const res = await getChatHistory({ limit: 100 })
    if (res.code === 200) {
      realtimeMessages.value = res.data.messages
      realtimeTotal.value = res.data.total
    }
  }
  catch {
    toast.error('获取聊天记录失败')
  }
  finally {
    realtimeLoading.value = false
  }
}

async function fetchHistoryDates() {
  try {
    const res = await getChatLogDates()
    if (res.code === 200) {
      availableDates.value = res.data.dates
      if (!availableDates.value.includes(todayStr))
        availableDates.value.unshift(todayStr)
    }
  }
  catch {}
}

async function fetchHistory() {
  historyLoading.value = true
  try {
    const query: Record<string, any> = {
      page: historyPage.value,
      pageSize: historyPageSize.value,
    }
    if (selectedDate.value)
      query.date = selectedDate.value
    if (senderFilter.value.trim())
      query.sender = senderFilter.value.trim()
    if (keywordFilter.value.trim())
      query.keyword = keywordFilter.value.trim()

    const res = await getChatLog(query)
    if (res.code === 200) {
      historyMessages.value = res.data.messages
      historyTotal.value = res.data.pagination.total
    }
  }
  catch {
    toast.error('获取历史记录失败')
  }
  finally {
    historyLoading.value = false
  }
}

async function handleSend() {
  if (!sendMessage.value.trim()) {
    toast.error('请输入消息内容')
    return
  }
  sendLoading.value = true
  try {
    const res = await sendChatMessage(sendMessage.value.trim())
    if (res.code === 200) {
      toast.success('消息已发送')
      sendMessage.value = ''
      fetchRealtime()
    }
    else {
      toast.error(res.msg || '发送失败')
    }
  }
  catch {
    toast.error('网络错误')
  }
  finally {
    sendLoading.value = false
  }
}

function handleHistoryPageChange(page: number) {
  historyPage.value = page
  fetchHistory()
}

function handleHistorySearch() {
  historyPage.value = 1
  fetchHistory()
}

function handleRefresh() {
  if (activeTab.value === 'realtime') {
    fetchRealtime()
    toast.success('已刷新聊天记录')
  }
  else {
    fetchHistory()
    toast.success('已刷新历史记录')
  }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

// 最新消息排最前
const displayRealtime = computed(() => [...realtimeMessages.value].sort((a, b) => b.time - a.time))
const displayHistory = computed(() => [...historyMessages.value].sort((a, b) => b.time - a.time))

function formatHistoryTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

const totalPages = computed(() => Math.ceil(historyTotal.value / historyPageSize.value))

onMounted(async () => {
  await fetchHistoryDates()
  fetchRealtime()
})

let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => {
    if (activeTab.value === 'realtime')
      fetchRealtime()
  }, 15000)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<template>
  <BasicPage title="聊天管理" description="发送服务器消息与查看聊天记录" sticky>
    <template #actions>
      <div class="flex items-center gap-2">
        <UiButton variant="outline" size="sm" :disabled="realtimeLoading || historyLoading" @click="handleRefresh">
          <RefreshCwIcon class="size-4 mr-1" />
          刷新
        </UiButton>
      </div>
    </template>

    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <UiTabs v-model="activeTab" class="w-auto">
          <UiTabsList>
            <UiTabsTrigger value="realtime" @click="activeTab = 'realtime'">
              实时聊天
            </UiTabsTrigger>
            <UiTabsTrigger value="history" @click="activeTab = 'history'; fetchHistory()">
              聊天记录
            </UiTabsTrigger>
          </UiTabsList>
        </UiTabs>
      </div>

      <template v-if="activeTab === 'realtime'">
        <div class="flex flex-col h-[calc(100vh-240px)] min-h-[400px]">
          <div class="border rounded-md bg-muted/50 px-4 py-2 flex items-center justify-between shrink-0">
            <span class="text-sm font-medium">实时聊天 ({{ realtimeTotal }} 条)</span>
            <span class="text-xs text-muted-foreground">每15秒自动刷新</span>
          </div>
          <div class="border-x border-b flex-1 overflow-y-auto p-2 space-y-1 bg-[#1E1E1E] min-h-0">
            <div v-if="realtimeLoading && realtimeMessages.length === 0" class="flex items-center justify-center py-8">
              <UiSpinner class="size-5" />
            </div>
            <div v-else-if="realtimeMessages.length === 0" class="text-center text-sm text-muted-foreground py-8">
              暂无聊天记录
            </div>
            <template v-else>
              <div
                v-for="(msg, i) in displayRealtime"
                :key="i"
                class="flex items-start gap-2 px-3 py-1.5 rounded-md hover:bg-white/10"
              >
                <span class="text-xs text-gray-400 whitespace-nowrap font-mono pt-0.5">
                  {{ formatTime(msg.time) }}
                </span>
                <span
                  class="text-xs px-1.5 py-0.5 rounded font-semibold whitespace-nowrap"
                  :class="msg.type === 'server' ? 'bg-orange-900/60 text-orange-300' : 'bg-blue-900/60 text-blue-300'"
                >
                  {{ msg.type === 'server' ? '服务器' : '玩家' }}
                </span>
                <span class="text-sm font-medium whitespace-nowrap" :class="msg.type === 'server' ? 'text-orange-400' : 'text-gray-200'">
                  {{ msg.sender }}
                </span>
                <span class="text-sm text-gray-100">{{ msg.message }}</span>
              </div>
            </template>
          </div>
          <div class="border-x border-b rounded-b-md bg-muted/30 p-2 flex items-center gap-2 shrink-0">
            <UiInput
              v-model="sendMessage"
              placeholder="输入服务器消息..."
              class="flex-1"
              :disabled="sendLoading"
              @keydown.enter="handleSend"
            />
            <UiButton :disabled="sendLoading || !sendMessage.trim()" @click="handleSend">
              <SendIcon class="size-4 mr-1" />
              发送
            </UiButton>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="space-y-3">
          <div class="flex items-center gap-3 flex-wrap">
            <div class="flex items-center gap-2">
              <span class="text-sm text-muted-foreground">日期:</span>
              <UiSelect :model-value="selectedDate" @update:model-value="(v: any) => { selectedDate = String(v); handleHistorySearch() }">
                <UiSelectTrigger class="w-[160px]">
                  <UiSelectValue placeholder="选择日期" />
                </UiSelectTrigger>
                <UiSelectContent>
                  <UiSelectItem v-for="d in availableDates" :key="d" :value="d">
                    {{ d }}
                  </UiSelectItem>
                </UiSelectContent>
              </UiSelect>
            </div>
            <UiInput
              v-model="senderFilter"
              placeholder="发送者"
              class="w-[140px]"
              @keydown.enter="handleHistorySearch"
            />
            <UiInput
              v-model="keywordFilter"
              placeholder="关键词"
              class="w-[140px]"
              @keydown.enter="handleHistorySearch"
            />
            <UiButton variant="outline" size="sm" @click="handleHistorySearch">
              搜索
            </UiButton>
            <span class="text-sm text-muted-foreground">
              共 {{ historyTotal }} 条记录
            </span>
          </div>

          <div class="border rounded-md">
            <div class="max-h-[calc(100vh-320px)] overflow-y-auto p-2 space-y-1">
              <div v-if="historyLoading && historyMessages.length === 0" class="flex items-center justify-center py-8">
                <UiSpinner class="size-5" />
              </div>
              <div v-else-if="historyMessages.length === 0" class="text-center text-sm text-muted-foreground py-8">
                暂无历史记录
              </div>
              <template v-else>
                <div
                  v-for="(msg, i) in displayHistory"
                  :key="i"
                  class="flex items-start gap-2 px-3 py-1.5 rounded-md hover:bg-muted/50"
                >
                  <span class="text-xs text-muted-foreground whitespace-nowrap font-mono pt-0.5">
                    {{ formatHistoryTime(msg.time) }}
                  </span>
                  <span
                    class="text-xs px-1.5 py-0.5 rounded font-semibold whitespace-nowrap"
                    :class="msg.type === 'server' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'"
                  >
                    {{ msg.type === 'server' ? '服务器' : '玩家' }}
                  </span>
                  <span class="text-sm font-medium whitespace-nowrap" :class="msg.type === 'server' ? 'text-orange-600' : ''">
                    {{ msg.sender }}
                  </span>
                  <span class="text-sm text-foreground">{{ msg.message }}</span>
                </div>
              </template>
            </div>
          </div>

          <div v-if="totalPages > 1" class="flex items-center justify-center gap-2">
            <UiButton
              variant="outline"
              size="sm"
              :disabled="historyPage <= 1"
              @click="handleHistoryPageChange(historyPage - 1)"
            >
              上一页
            </UiButton>
            <span class="text-sm text-muted-foreground">
              {{ historyPage }} / {{ totalPages }}
            </span>
            <UiButton
              variant="outline"
              size="sm"
              :disabled="historyPage >= totalPages"
              @click="handleHistoryPageChange(historyPage + 1)"
            >
              下一页
            </UiButton>
          </div>
        </div>
      </template>
    </div>
  </BasicPage>
</template>
