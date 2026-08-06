<script setup lang="ts">
import { DownloadIcon, RefreshCwIcon, TrashIcon, UploadIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IStructureItem } from '@/services/api/structure.api'

import { BasicPage } from '@/components/global-layout'
import { useStructureApi } from '@/services/api/structure.api'

const { getStructureList, deleteStructure, downloadStructure, uploadStructure } = useStructureApi()

const loading = ref(true)
const items = ref<IStructureItem[]>([])

const deleteDialogOpen = ref(false)
const deleteTarget = ref<IStructureItem | null>(null)
const deleteLoading = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

async function fetchList() {
  loading.value = true
  try {
    const res = await getStructureList()
    if (res.code === 200)
      items.value = res.data ?? []
    else
      toast.error(res.msg || '获取建筑文件列表失败')
  }
  catch {
    toast.error('获取建筑文件列表失败')
  }
  finally {
    loading.value = false
  }
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file)
    return
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  if (ext !== '.mcstructure' && ext !== '.nbt') {
    toast.error('仅支持 .mcstructure 或 .nbt 建筑文件')
    input.value = ''
    return
  }
  doUpload(file)
  input.value = ''
}

async function doUpload(file: File) {
  uploading.value = true
  try {
    const res = await uploadStructure(file)
    if (res.code === 200) {
      toast.success(`上传成功: ${res.data?.filename}`)
      fetchList()
    }
    else {
      toast.error(res.msg || '上传失败')
    }
  }
  catch {
    toast.error('上传失败')
  }
  finally {
    uploading.value = false
  }
}

async function handleDownload(item: IStructureItem) {
  try {
    await downloadStructure(item.filename)
    toast.info(`正在下载 ${item.filename}...`)
  }
  catch (e: any) {
    toast.error(e?.message || '下载失败')
  }
}

function openDeleteDialog(item: IStructureItem) {
  deleteTarget.value = item
  deleteDialogOpen.value = true
}

async function handleDelete() {
  if (!deleteTarget.value)
    return
  deleteLoading.value = true
  try {
    const res = await deleteStructure(deleteTarget.value.filename)
    if (res.code === 200) {
      toast.success('建筑文件已删除')
      fetchList()
    }
    else {
      toast.error(res.msg || '删除失败')
    }
  }
  catch {
    toast.error('删除失败')
  }
  finally {
    deleteLoading.value = false
    deleteDialogOpen.value = false
  }
}

onMounted(() => {
  fetchList()
})
</script>

<template>
  <BasicPage title="建筑管理" description="管理服务器建筑文件">
    <div class="flex items-center justify-between mb-4">
      <UiButton variant="outline" size="sm" :disabled="uploading" @click="fileInput?.click()">
        <UploadIcon class="size-4 mr-1" />
        {{ uploading ? '上传中...' : '上传建筑文件' }}
      </UiButton>
      <input ref="fileInput" type="file" accept=".mcstructure,.nbt" class="hidden" @change="handleFileChange">
      <UiButton variant="outline" size="sm" @click="fetchList">
        <RefreshCwIcon class="size-4 mr-1" />
        刷新
      </UiButton>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-12">
      <UiSpinner class="size-6" />
    </div>

    <div v-else class="border rounded-lg">
      <div class="grid grid-cols-[1fr_100px_110px_160px_100px] gap-4 px-4 py-3 border-b text-xs text-muted-foreground font-medium items-center">
        <span>文件名</span>
        <span>类型</span>
        <span>大小</span>
        <span>修改时间</span>
        <span>操作</span>
      </div>
      <div v-if="items.length === 0" class="p-4 text-center text-muted-foreground text-sm">
        暂无建筑文件
      </div>
      <div
        v-for="item in items"
        :key="item.filename"
        class="grid grid-cols-[1fr_100px_110px_160px_100px] gap-4 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 items-center"
      >
        <span class="text-sm font-mono truncate" :title="item.filename">{{ item.filename }}</span>
        <span>
          <UiBadge variant="outline">{{ item.type === 'mcstructure' ? 'mcstructure' : 'nbt' }}</UiBadge>
        </span>
        <span class="text-sm">{{ item.sizeFormatted }}</span>
        <span class="text-sm text-muted-foreground">{{ item.timeFormatted }}</span>
        <div class="flex items-center gap-1">
          <UiButton variant="ghost" size="icon" class="size-8" title="下载" @click="handleDownload(item)">
            <DownloadIcon class="size-4" />
          </UiButton>
          <UiButton variant="ghost" size="icon" class="size-8 text-destructive" title="删除" @click="openDeleteDialog(item)">
            <TrashIcon class="size-4" />
          </UiButton>
        </div>
      </div>
    </div>

    <UiDialog v-model:open="deleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>删除建筑文件</UiDialogTitle>
          <UiDialogDescription>
            确定要删除建筑文件「{{ deleteTarget?.filename }}」吗？此操作不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <UiDialogFooter>
          <UiButton variant="outline" @click="deleteDialogOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" :disabled="deleteLoading" @click="handleDelete">
            {{ deleteLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>
  </BasicPage>
</template>
