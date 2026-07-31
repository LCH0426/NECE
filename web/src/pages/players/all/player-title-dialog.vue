<script setup lang="ts">
import { PlusIcon, TrashIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IPlayer } from '@/services/api/player.api'

import { usePlayerApi } from '@/services/api/player.api'

const props = defineProps<{
  player: IPlayer
}>()

const { getPlayerTitles, addPlayerTitle, setActiveTitle, deletePlayerTitle } = usePlayerApi()

const open = defineModel<boolean>('open', { default: false })

const titles = ref<string[]>([])
const activeTitle = ref<string | null>(null)
const loading = ref(false)
const newTitle = ref('')
const addLoading = ref(false)

async function fetchTitles() {
  loading.value = true
  try {
    const res = await getPlayerTitles(props.player.xuid)
    if (res.code === 200) {
      titles.value = res.data.owned
      activeTitle.value = res.data.active
    }
  }
  catch {
    toast.error('获取称号列表失败')
  }
  finally {
    loading.value = false
  }
}

async function handleAddTitle() {
  if (!newTitle.value.trim())
    return
  addLoading.value = true
  try {
    const res = await addPlayerTitle(props.player.xuid, newTitle.value.trim())
    if (res.code === 200) {
      toast.success('称号添加成功')
      newTitle.value = ''
      fetchTitles()
    }
    else {
      toast.error(res.msg || '添加失败')
    }
  }
  catch {
    toast.error('网络错误')
  }
  finally {
    addLoading.value = false
  }
}

async function handleSetActive(title: string) {
  try {
    const res = await setActiveTitle(props.player.xuid, title)
    if (res.code === 200) {
      activeTitle.value = title
      toast.success(`当前称号已设为 ${title}`)
    }
    else {
      toast.error(res.msg || '设置失败')
    }
  }
  catch {
    toast.error('网络错误')
  }
}

async function handleDeleteTitle(title: string) {
  try {
    const res = await deletePlayerTitle(props.player.xuid, title)
    if (res.code === 200) {
      toast.success('称号已删除')
      if (activeTitle.value === title)
        activeTitle.value = null
      fetchTitles()
    }
    else {
      toast.error(res.msg || '删除失败')
    }
  }
  catch {
    toast.error('网络错误')
  }
}

watch(open, (v) => {
  if (v)
    fetchTitles()
})

onMounted(() => {
  if (open.value)
    fetchTitles()
})
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="sm:max-w-[425px]">
      <UiDialogHeader>
        <UiDialogTitle>称号管理</UiDialogTitle>
        <UiDialogDescription>
          管理 {{ player.name }} 的称号
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-4 py-4">
        <div class="flex gap-2">
          <UiInput v-model="newTitle" placeholder="输入新称号" class="flex-1" @keydown.enter="handleAddTitle" />
          <UiButton size="sm" :disabled="addLoading || !newTitle.trim()" @click="handleAddTitle">
            <PlusIcon class="size-4 mr-1" />
            添加
          </UiButton>
        </div>

        <div v-if="loading" class="flex justify-center py-4">
          <UiSpinner class="size-5" />
        </div>

        <div v-else-if="titles.length === 0" class="text-center text-sm text-muted-foreground py-4">
          暂无称号
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="title in titles"
            :key="title"
            class="flex items-center justify-between rounded-md border px-3 py-2"
          >
            <div class="flex items-center gap-2">
              <span class="text-sm">{{ title }}</span>
              <UiBadge v-if="title === activeTitle" variant="default" class="text-xs">
                当前
              </UiBadge>
            </div>
            <div class="flex items-center gap-1">
              <UiButton
                v-if="title !== activeTitle"
                variant="ghost"
                size="sm"
                class="h-7 text-xs"
                @click="handleSetActive(title)"
              >
                设为当前
              </UiButton>
              <UiButton
                variant="ghost"
                size="icon"
                class="size-7 text-destructive"
                @click="handleDeleteTitle(title)"
              >
                <TrashIcon class="size-3.5" />
              </UiButton>
            </div>
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
