<script setup lang="ts">
import { ref, watch } from 'vue'
import Vcode from 'vue-sliding-puzzle'
import 'vue-sliding-puzzle/css'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'success'): void
}>()

// 构建时自动收集 src/assets/img/captcha/ 下所有 webp 图片
const captchaModules = import.meta.glob('@/assets/img/captcha/*.webp', { eager: true, import: 'default' }) as Record<string, string>
const allImages = Object.values(captchaModules)

// 随机选择 5 张图片
function getRandomImages(): string[] {
  const shuffled = [...allImages].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 5)
}

const images = ref(getRandomImages())

const show = ref(false)

watch(() => props.open, (val) => {
  if (val) {
    // 每次打开时重新随机选择图片
    images.value = getRandomImages()
  }
  show.value = val
})

function handleSuccess() {
  emit('success')
  emit('update:open', false)
}

function handleClose() {
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-9999 flex items-center justify-center bg-black/50"
      @click.self="handleClose"
    >
      <div class="bg-background rounded-lg shadow-xl p-6 max-w-[400px] w-full mx-4">
        <h3 class="text-lg font-semibold mb-4">
          安全验证
        </h3>
        <div class="relative w-[310px] h-[210px] mx-auto mb-4">
          <Vcode
            type="inside"
            :show="show"
            :imgs="images"
            slider-text="请拖动滑块完成验证"
            success-text="验证通过"
            fail-text="验证失败，请重试"
            :interference-diagram-count="2"
            :range="10"
            @success="handleSuccess"
            @close="handleClose"
          />
        </div>
        <div class="flex justify-end">
          <button
            class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            @click="handleClose"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
