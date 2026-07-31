<script setup lang="ts">
import { ImageIcon, RefreshCwIcon, SearchIcon, Trash2Icon, XIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import UiButton from '@/components/ui/button/Button.vue'
import UiCard from '@/components/ui/card/Card.vue'
import UiCardContent from '@/components/ui/card/CardContent.vue'
import UiCardHeader from '@/components/ui/card/CardHeader.vue'
import UiCardTitle from '@/components/ui/card/CardTitle.vue'
import UiInput from '@/components/ui/input/Input.vue'
import UiSpinner from '@/components/ui/spinner/Spinner.vue'
import type { IMapArtAdminListParams, IMapArtItem } from '@/services/api/mapart.api'
import { useMapArtApi } from '@/services/api/mapart.api'

const { getMapArtAdminList, deleteMapArt, getMapArtImage } = useMapArtApi()

// --- State ---
const list = ref<IMapArtItem[]>([])
const loading = ref(false)
const searchUid = ref('')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const totalPages = ref(0)
const imageUrls = ref<Record<number, string>>({})
const previewUrl = ref<string | null>(null)
const previewName = ref('')

// --- Load ---
async function loadList() {
  loading.value = true
  try {
    const params: IMapArtAdminListParams = {
      page: page.value,
      pageSize: pageSize.value,
    }
    if (searchUid.value.trim()) {
      params.uid = searchUid.value.trim()
    }
    const res = await getMapArtAdminList(params)
    if (res.code === 200) {
      list.value = res.data.items || []
      total.value = res.data.total
      totalPages.value = res.data.totalPages
      for (const item of list.value) {
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
    loading.value = false
  }
}

async function loadThumbnail(id: number) {
  const url = await getMapArtImage(id)
  if (url) {
    imageUrls.value[id] = url
  }
}

function handleSearch() {
  page.value = 1
  loadList()
}

function handleClear() {
  searchUid.value = ''
  page.value = 1
  loadList()
}

function goPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  loadList()
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// --- Delete ---
async function handleDelete(item: IMapArtItem) {
  try {
    const res = await deleteMapArt(item.id)
    if (res.code === 200) {
      toast.success('删除成功')
      if (imageUrls.value[item.id]) {
        URL.revokeObjectURL(imageUrls.value[item.id])
        delete imageUrls.value[item.id]
      }
      loadList()
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
  loadList()
})
</script>

<template>
  <div class="space-y-6">
    <UiCard>
      <UiCardHeader>
        <div class="flex items-center justify-between">
          <UiCardTitle class="text-base">
            地图画管理
          </UiCardTitle>
          <UiButton variant="outline" size="sm" @click="loadList">
            <RefreshCwIcon class="size-4" />
            刷新
          </UiButton>
        </div>
      </UiCardHeader>
      <UiCardContent>
        <!-- Search -->
        <div class="flex gap-2 mb-4">
          <div class="relative flex-1">
            <SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <UiInput
              v-model="searchUid"
              placeholder="按 UID 筛选"
              class="pl-9"
              @keyup.enter="handleSearch"
            />
          </div>
          <UiButton variant="secondary" @click="handleSearch">
            搜索
          </UiButton>
          <UiButton v-if="searchUid" variant="ghost" size="icon" @click="handleClear">
            <XIcon class="size-4" />
          </UiButton>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="flex justify-center py-12">
          <UiSpinner class="size-8" />
        </div>

        <!-- Empty -->
        <div v-else-if="list.length === 0" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <ImageIcon class="size-12 mb-3 opacity-30" />
          <span class="text-sm">暂无地图画数据</span>
        </div>

        <!-- Table -->
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b text-muted-foreground">
                <th class="text-left py-2 px-3 font-medium w-16">ID</th>
                <th class="text-left py-2 px-3 font-medium w-20">缩略图</th>
                <th class="text-left py-2 px-3 font-medium">文件名</th>
                <th class="text-left py-2 px-3 font-medium">上传者</th>
                <th class="text-left py-2 px-3 font-medium w-24">大小</th>
                <th class="text-left py-2 px-3 font-medium w-40">上传时间</th>
                <th class="text-right py-2 px-3 font-medium w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in list" :key="item.id" class="border-b hover:bg-muted/50 transition-colors">
                <td class="py-2 px-3 text-muted-foreground">
                  {{ item.id }}
                </td>
                <td class="py-2 px-3">
                  <div
                    class="w-12 h-12 rounded bg-muted cursor-pointer overflow-hidden hover:ring-2 hover:ring-primary/50 transition-all"
                    @click="openPreview(item)"
                  >
                    <img
                      v-if="imageUrls[item.id]"
                      :src="imageUrls[item.id]"
                      :alt="item.original_name"
                      class="w-full h-full object-cover"
                    >
                    <div v-else class="w-full h-full flex items-center justify-center">
                      <UiSpinner class="size-4" />
                    </div>
                  </div>
                </td>
                <td class="py-2 px-3 truncate max-w-[200px]">
                  {{ item.original_name || item.filename }}
                </td>
                <td class="py-2 px-3 text-muted-foreground">
                  {{ item.uploader || item.uid || '-' }}
                </td>
                <td class="py-2 px-3 text-muted-foreground">
                  {{ formatFileSize(item.file_size) }}
                </td>
                <td class="py-2 px-3 text-muted-foreground">
                  {{ item.upload_time }}
                </td>
                <td class="py-2 px-3 text-right">
                  <UiButton
                    variant="ghost"
                    size="icon-sm"
                    class="text-muted-foreground hover:text-destructive"
                    @click="handleDelete(item)"
                  >
                    <Trash2Icon class="size-4" />
                  </UiButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="flex items-center justify-between mt-4">
          <span class="text-sm text-muted-foreground">共 {{ total }} 条</span>
          <div class="flex items-center gap-1">
            <UiButton variant="outline" size="sm" :disabled="page <= 1" @click="goPage(page - 1)">
              上一页
            </UiButton>
            <span class="text-sm px-3">{{ page }} / {{ totalPages }}</span>
            <UiButton variant="outline" size="sm" :disabled="page >= totalPages" @click="goPage(page + 1)">
              下一页
            </UiButton>
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
