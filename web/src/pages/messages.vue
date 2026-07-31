<script setup lang="ts">
import { MessageSquareIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IMessage, IMessageListParams } from '@/services/api/messages.api'

import { useMessagesApi } from '@/services/api/messages.api'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const { getMessages, deleteMessage, createMessage } = useMessagesApi()

const loading = ref(true)
const messages = ref<IMessage[]>([])
const total = ref(0)
const currentPage = ref(1)
const totalPages = ref(0)
const searchInput = ref('')
const moodFilter = ref('')
const params = reactive<IMessageListParams>({
  page: 1,
  pageSize: 20,
  search: '',
  mood: '',
  includeDeleted: false,
})

const moods = ['开心', '难过', '平静', '兴奋', '生气']
const moodEmojis: Record<string, string> = {
  开心: '😊',
  难过: '😢',
  平静: '😐',
  兴奋: '🎉',
  生气: '😡',
}

async function fetchData() {
  loading.value = true
  try {
    const queryParams: IMessageListParams = {
      page: params.page,
      pageSize: params.pageSize,
    }
    if (searchInput.value.trim())
      queryParams.search = searchInput.value.trim()
    if (moodFilter.value)
      queryParams.mood = moodFilter.value

    const res = await getMessages(queryParams)

    if (res.code === 200) {
      const data = res.data
      messages.value = data.messages || []
      const p = data.pagination || data
      total.value = p.total || 0
      currentPage.value = p.page || 1
      totalPages.value = p.totalPages || 0
    }
    else {
      toast.error(res.msg || '获取留言列表失败')
    }
  }
  catch (error: any) {
    const msg = error?.data?.msg || error?.message || '网络错误'
    toast.error(`获取留言列表失败: ${msg}`)
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchData()
})

function handleSearch() {
  params.page = 1
  fetchData()
}

function handleMoodChange(value: any) {
  moodFilter.value = value === 'all' ? '' : String(value)
  params.page = 1
  fetchData()
}

function handlePageChange(page: number) {
  params.page = page
  fetchData()
}

// 删除留言
const deleteDialogOpen = ref(false)
const deleting = ref(false)
const selectedMessage = ref<IMessage | null>(null)
const deleteResult = ref('')

function openDeleteDialog(msg: IMessage) {
  selectedMessage.value = msg
  deleteResult.value = ''
  deleteDialogOpen.value = true
}

async function handleDelete() {
  if (!selectedMessage.value)
    return
  deleting.value = true
  try {
    const res = await deleteMessage(selectedMessage.value.id)
    if (res.code === 200) {
      deleteResult.value = '留言已删除'
      toast.success('留言已删除')
      fetchData()
    }
    else {
      toast.error(res.msg || '删除失败')
    }
  }
  catch {
    toast.error('删除失败')
  }
  finally {
    deleting.value = false
  }
}

// 发布留言
const createOpen = ref(false)
const creating = ref(false)
const newMessage = reactive({ content: '', mood: '平静' })

async function handleCreate() {
  if (!newMessage.content.trim()) {
    toast.error('请输入留言内容')
    return
  }
  creating.value = true
  try {
    const res = await createMessage({ content: newMessage.content, mood: newMessage.mood })
    if (res.code === 200) {
      toast.success('留言发布成功')
      newMessage.content = ''
      newMessage.mood = '平静'
      createOpen.value = false
      fetchData()
    }
    else {
      toast.error(res.msg || '发布失败')
    }
  }
  catch {
    toast.error('发布失败')
  }
  finally {
    creating.value = false
  }
}

function canDelete(msg: IMessage) {
  return msg.canDelete || false
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center gap-2 p-4 border-b">
      <h1 class="text-lg font-semibold">
        留言板
      </h1>
      <span class="text-sm text-muted-foreground">查看和发布留言</span>
      <div class="flex-1" />
      <UiButton variant="outline" size="sm" @click="fetchData">
        <RefreshCwIcon class="size-4 mr-1" />
        刷新
      </UiButton>
      <UiButton size="sm" @click="createOpen = true">
        <PlusIcon class="size-4 mr-1" />
        发布留言
      </UiButton>
    </div>

    <div class="flex-1 overflow-auto p-4">
      <!-- 筛选条件 -->
      <div class="flex flex-col sm:flex-row gap-3 mb-6">
        <UiInput
          v-model="searchInput"
          :placeholder="authStore.isAdmin ? '搜索玩家名/留言内容' : '搜索留言内容'"
          class="sm:w-64"
          @keyup.enter="handleSearch"
        />
        <UiSelect :model-value="moodFilter || 'all'" @update:model-value="handleMoodChange">
          <UiSelectTrigger class="sm:w-32">
            <UiSelectValue placeholder="全部心情" />
          </UiSelectTrigger>
          <UiSelectContent>
            <UiSelectItem value="all">
              全部心情
            </UiSelectItem>
            <UiSelectItem v-for="mood in moods" :key="mood" :value="mood">
              {{ moodEmojis[mood] }} {{ mood }}
            </UiSelectItem>
          </UiSelectContent>
        </UiSelect>
        <UiButton variant="outline" size="sm" @click="handleSearch">
          搜索
        </UiButton>
      </div>

      <div v-if="loading" class="flex items-center justify-center py-12">
        <UiSpinner class="size-6" />
      </div>

      <div v-else-if="messages.length === 0" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <MessageSquareIcon class="size-12 mb-4" />
        <p class="text-sm">
          暂无留言
        </p>
      </div>

      <div v-else class="space-y-4">
        <!-- 留言列表 -->
        <div class="border rounded-lg divide-y">
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="p-4 hover:bg-muted/30"
            :class="{ 'opacity-50': msg.isDeleted }"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="font-medium text-sm">
                    {{ msg.playerName }}
                  </span>
                  <span v-if="msg.mood" class="text-xs bg-muted px-2 py-0.5 rounded-full">
                    {{ moodEmojis[msg.mood] || '' }} {{ msg.mood }}
                  </span>
                  <span v-if="msg.isDeleted" class="text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                    已删除
                  </span>
                </div>
                <p class="text-sm text-muted-foreground break-all">
                  {{ msg.msg }}
                </p>
                <div class="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span>{{ msg.time }}</span>
                  <span>来自: {{ msg.client }}</span>
                  <span v-if="authStore.isAdmin">XUID: {{ msg.xuid }}</span>
                </div>
              </div>
              <UiButton
                v-if="!msg.isDeleted && canDelete(msg)"
                variant="ghost"
                size="icon"
                class="text-destructive hover:text-destructive"
                @click="openDeleteDialog(msg)"
              >
                <Trash2Icon class="size-4" />
              </UiButton>
            </div>
          </div>
        </div>

        <!-- 分页 -->
        <div v-if="totalPages > 1" class="flex items-center justify-between">
          <div class="text-sm text-muted-foreground">
            共 {{ total }} 条留言
          </div>
          <div class="flex items-center gap-2">
            <UiButton
              variant="outline"
              size="sm"
              :disabled="currentPage <= 1"
              @click="handlePageChange(currentPage - 1)"
            >
              上一页
            </UiButton>
            <span class="text-sm">
              {{ currentPage }} / {{ totalPages }}
            </span>
            <UiButton
              variant="outline"
              size="sm"
              :disabled="currentPage >= totalPages"
              @click="handlePageChange(currentPage + 1)"
            >
              下一页
            </UiButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 发布留言对话框 -->
    <UiDialog v-model:open="createOpen">
      <UiDialogContent class="sm:max-w-[500px]">
        <UiDialogHeader>
          <UiDialogTitle>发布留言</UiDialogTitle>
        </UiDialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm">留言内容</label>
            <UiTextarea
              v-model="newMessage.content"
              placeholder="输入留言内容（最多500字）"
              :maxlength="500"
              rows="4"
            />
            <div class="text-xs text-muted-foreground text-right">
              {{ newMessage.content.length }} / 500
            </div>
          </div>
          <div class="space-y-2">
            <label class="text-sm">心情</label>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="mood in moods"
                :key="mood"
                class="px-3 py-1.5 rounded-md text-sm border transition-colors"
                :class="newMessage.mood === mood ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
                @click="newMessage.mood = mood"
              >
                {{ moodEmojis[mood] }} {{ mood }}
              </button>
            </div>
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="createOpen = false">
            取消
          </UiButton>
          <UiButton :disabled="creating" @click="handleCreate">
            {{ creating ? '发布中...' : '发布' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <!-- 删除确认对话框 -->
    <UiDialog v-model:open="deleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>删除留言</UiDialogTitle>
          <UiDialogDescription>
            确定要删除这条留言吗？此操作不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!deleteResult" class="py-4">
          <div class="rounded-md bg-muted p-3 text-sm">
            <p class="font-medium">
              {{ selectedMessage?.playerName }}
            </p>
            <p class="text-muted-foreground mt-1">
              {{ selectedMessage?.msg }}
            </p>
          </div>
        </div>
        <div v-else class="py-4">
          <div class="rounded-md bg-muted p-3 text-sm">
            {{ deleteResult }}
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="deleteDialogOpen = false">
            {{ deleteResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!deleteResult" variant="destructive" :disabled="deleting" @click="handleDelete">
            {{ deleting ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>
  </div>
</template>
