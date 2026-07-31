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

<script setup lang="ts">
import { useTexture } from '@/composables/use-texture'

const props = defineProps<{
  texture: string | undefined | null
  size?: number
}>()

const { getTextureUrl } = useTexture()

// 计算材质 URL
const imageUrl = computed(() => getTextureUrl(props.texture))
const error = ref(false)
const elRef = ref<HTMLElement | null>(null)

// 使用 IntersectionObserver 懒加载
let observer: IntersectionObserver | null = null
const isVisible = ref(false)

function setupObserver() {
  if (!elRef.value || typeof IntersectionObserver === 'undefined') {
    isVisible.value = true
    return
  }

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        isVisible.value = true
        observer?.disconnect()
        observer = null
      }
    },
    { rootMargin: '200px' },
  )
  observer.observe(elRef.value)
}

// texture 变化时重置错误状态
watch(() => props.texture, () => {
  error.value = false
})

function handleImageError() {
  error.value = true
}

onMounted(() => {
  setupObserver()
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <span
    ref="elRef"
    class="inline-flex items-center justify-center shrink-0 overflow-hidden"
    :style="{ width: `${size ?? 24}px`, height: `${size ?? 24}px` }"
  >
    <img
      v-if="isVisible && imageUrl && !error"
      :src="imageUrl"
      :style="{ width: `${size ?? 24}px`, height: `${size ?? 24}px`, imageRendering: 'pixelated' }"
      @error="handleImageError"
    >
    <span
      v-else
      class="block rounded-sm bg-muted"
      :style="{ width: `${size ?? 24}px`, height: `${size ?? 24}px` }"
    />
  </span>
</template>
