<script setup lang="ts">
import {
  ImageIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IMapArtItem, IMapArtQuota } from '@/services/api/mapart.api'

import UiButton from '@/components/ui/button/Button.vue'
import UiCard from '@/components/ui/card/Card.vue'
import UiCardContent from '@/components/ui/card/CardContent.vue'
import UiCardHeader from '@/components/ui/card/CardHeader.vue'
import UiCardTitle from '@/components/ui/card/CardTitle.vue'
import UiInput from '@/components/ui/input/Input.vue'
import UiSpinner from '@/components/ui/spinner/Spinner.vue'
import { useMapArtApi } from '@/services/api/mapart.api'

const { uploadMapArt, getMapArtList, deleteMapArt, getMapArtImage, getQuota } = useMapArtApi()

// --- State ---
const mapArtList = ref<IMapArtItem[]>([])
const listLoading = ref(false)
const uploading = ref(false)
const imageUrls = ref<Record<number, string>>({})
const previewUrl = ref<string | null>(null)
const previewName = ref('')
const customName = ref('')
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const quota = ref<IMapArtQuota>({ used: 0, limit: 20971520, usedMB: '0', limitMB: '20' })

// --- List ---
async function loadMapArtList() {
  listLoading.value = true
  try {
    const res = await getMapArtList()
    if (res.code === 200) {
      mapArtList.value = res.data || []
      for (const item of mapArtList.value) {
        if (!imageUrls.value[item.id]) {
          loadThumbnail(item.id)
        }
      }
    }
  }
  catch {
    toast.error('获取列表失败')
  }
  finally {
    listLoading.value = false
  }
}

async function loadQuota() {
  try {
    const res = await getQuota()
    if (res.code === 200) {
      quota.value = res.data
    }
  }
  catch {}
}

async function loadThumbnail(id: number) {
  const url = await getMapArtImage(id)
  if (url) {
    imageUrls.value[id] = url
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// --- Upload ---
async function handleUpload(file: File) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.type)) {
    toast.error('仅支持 JPG/PNG/WebP 格式图片')
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    toast.error('文件大小不能超过 10MB')
    return
  }

  uploading.value = true
  try {
    const name = customName.value.trim() || undefined
    const res = await uploadMapArt(file, name)
    if (res.code === 200) {
      toast.success('上传成功')
      customName.value = ''
      await Promise.all([loadMapArtList(), loadQuota()])
    }
    else {
      toast.error(res.msg || '上传失败')
    }
  }
  catch (error: any) {
    toast.error(error?.data?.msg || '上传失败')
    loadQuota()
  }
  finally {
    uploading.value = false
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) {
    handleUpload(input.files[0])
    input.value = ''
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files[0]
  if (file) {
    handleUpload(file)
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function onDragLeave() {
  isDragging.value = false
}

// --- Delete ---
async function handleDelete(id: number) {
  try {
    const res = await deleteMapArt(id)
    if (res.code === 200) {
      toast.success('删除成功')
      if (imageUrls.value[id]) {
        URL.revokeObjectURL(imageUrls.value[id])
        delete imageUrls.value[id]
      }
      mapArtList.value = mapArtList.value.filter(item => item.id !== id)
      loadQuota()
    }
    else {
      toast.error(res.msg || '删除失败')
    }
  }
  catch (error: any) {
    toast.error(error?.data?.msg || '删除失败')
  }
}

// --- Preview ---
async function openPreview(item: IMapArtItem) {
  if (!imageUrls.value[item.id]) {
    const url = await getMapArtImage(item.id)
    if (url) {
      imageUrls.value[item.id] = url
    }
  }
  previewUrl.value = imageUrls.value[item.id] || null
  previewName.value = item.original_name || item.filename
}

function closePreview() {
  previewUrl.value = null
  previewName.value = ''
}

// --- Init ---
onMounted(() => {
  loadMapArtList()
  loadQuota()
})
</script>

<template>
  <div class="space-y-6">
    <!-- Upload Area -->
    <UiCard>
      <UiCardHeader>
        <div class="flex items-center justify-between">
          <UiCardTitle class="text-base">
            上传地图画
          </UiCardTitle>
          <div v-if="quota" class="flex items-center gap-3 text-sm">
            <span class="text-muted-foreground">容量</span>
            <div class="w-32 h-2 bg-muted rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all"
                :class="(quota.used / quota.limit) > 0.9 ? 'bg-destructive' : (quota.used / quota.limit) > 0.7 ? 'bg-yellow-500' : 'bg-primary'"
                :style="{ width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` }"
              />
            </div>
            <span class="text-muted-foreground tabular-nums">{{ quota.usedMB }}MB / {{ quota.limitMB }}MB</span>
          </div>
        </div>
      </UiCardHeader>
      <UiCardContent>
        <div class="flex gap-3 mb-4">
          <UiInput
            v-model="customName"
            type="text"
            placeholder="自定义名称（可选）"
          />
        </div>
        <div
          class="border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer"
          :class="isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'"
          @drop.prevent="onDrop"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @click="fileInput?.click()"
        >
          <input
            ref="fileInput"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            class="hidden"
            @change="onFileChange"
          >
          <div v-if="uploading" class="flex flex-col items-center gap-2">
            <UiSpinner class="size-8" />
            <span class="text-sm text-muted-foreground">上传中...</span>
          </div>
          <div v-else class="flex flex-col items-center gap-2">
            <UploadIcon class="size-10 text-muted-foreground/50" />
            <span class="text-sm text-muted-foreground">拖拽图片到此处，或点击选择文件</span>
            <span class="text-xs text-muted-foreground/70">支持 JPG / PNG / WebP，最大 10MB</span>
          </div>
        </div>
      </UiCardContent>
    </UiCard>

    <!-- List -->
    <UiCard>
      <UiCardHeader>
        <div class="flex items-center justify-between">
          <UiCardTitle class="text-base">
            已上传地图画
          </UiCardTitle>
          <UiButton variant="outline" size="sm" @click="loadMapArtList(); loadQuota()">
            <RefreshCwIcon class="size-4" />
            刷新
          </UiButton>
        </div>
      </UiCardHeader>
      <UiCardContent>
        <div v-if="listLoading" class="flex justify-center py-12">
          <UiSpinner class="size-8" />
        </div>

        <div v-else-if="mapArtList.length === 0" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <ImageIcon class="size-12 mb-3 opacity-30" />
          <span class="text-sm">暂无已上传的地图画</span>
        </div>

        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <div
            v-for="item in mapArtList"
            :key="item.id"
            class="group rounded-lg border bg-card overflow-hidden hover:shadow-md transition-all"
          >
            <div
              class="aspect-square bg-muted cursor-pointer relative overflow-hidden"
              @click="openPreview(item)"
            >
              <img
                v-if="imageUrls[item.id]"
                :src="imageUrls[item.id]"
                :alt="item.original_name"
                class="w-full h-full object-cover"
              >
              <div v-else class="w-full h-full flex items-center justify-center">
                <UiSpinner class="size-6" />
              </div>
              <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <span class="opacity-0 group-hover:opacity-100 text-xs bg-black/60 text-white px-2 py-1 rounded transition-opacity">
                  预览
                </span>
              </div>
            </div>
            <div class="p-3">
              <p class="text-xs truncate font-medium" :title="item.original_name">
                {{ item.original_name || item.filename }}
              </p>
              <div class="flex items-center justify-between mt-1.5">
                <span class="text-xs text-muted-foreground">{{ formatFileSize(item.file_size) }}</span>
                <UiButton
                  variant="ghost"
                  size="icon-sm"
                  class="text-muted-foreground hover:text-destructive"
                  @click="handleDelete(item.id)"
                >
                  <Trash2Icon class="size-3.5" />
                </UiButton>
              </div>
            </div>
          </div>
        </div>
      </UiCardContent>
    </UiCard>

    <!-- Image Preview -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="previewUrl"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          @click.self="closePreview"
        >
          <div class="flex flex-col items-center gap-2 max-w-[90vw]">
            <div class="flex items-center justify-between w-full">
              <span class="text-sm text-white/80 drop-shadow">{{ previewName }}</span>
              <UiButton variant="ghost" size="icon-sm" class="text-white/80 hover:text-white hover:bg-white/20" @click="closePreview">
                <XIcon class="size-4" />
              </UiButton>
            </div>
            <img
              :src="previewUrl"
              :alt="previewName"
              class="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
            >
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
