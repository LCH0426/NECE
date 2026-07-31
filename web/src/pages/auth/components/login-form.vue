<script lang="ts" setup>
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { z } from 'zod'

import SlideVerifyDialog from '@/components/slide-verify-dialog.vue'
import { useAuth } from '@/composables/use-auth'

const loginSchema = z.object({
  uid: z.string().min(1, '请输入UID'),
  password: z.string().min(1, '请输入密码'),
  captchaCode: z.string().min(1, '请输入验证码'),
})

const { handleSubmit, values, setFieldValue } = useForm({
  validationSchema: toTypedSchema(loginSchema),
  initialValues: {
    uid: '',
    password: '',
    captchaCode: '',
  },
})

const { login, loading, captchaData, captchaLoading, refreshCaptcha } = useAuth()

// 逻辑：
// 1. 页面加载时显示"点击获取验证码"
// 2. 点击验证码区域 → 弹出滑动验证弹窗
// 3. 完成滑动验证 → 弹窗关闭 + 自动获取后端验证码
// 4. 之后点击验证码区域 → 直接刷新验证码（无需再验证）

const slideVerified = ref(false)
const showSlideVerify = ref(false)

function handleSlideSuccess() {
  slideVerified.value = true
  // 滑动验证成功后立即获取验证码
  refreshCaptcha()
}

function handleCaptchaClick() {
  if (!slideVerified.value) {
    // 未验证，弹出滑动验证
    showSlideVerify.value = true
  }
  else {
    // 已验证，直接刷新
    refreshCaptcha()
  }
}

function updateField(field: 'uid' | 'password' | 'captchaCode', value: string | number) {
  setFieldValue(field, String(value))
}

const onSubmit = handleSubmit(async (formValues) => {
  if (!captchaData.value)
    return
  await login({
    uid: formValues.uid,
    password: formValues.password,
    captchaId: captchaData.value.captchaId,
    captchaCode: formValues.captchaCode,
  })
})
</script>

<template>
  <UiCard class="w-full max-w-sm liquid-glass text-white">
    <UiCardHeader>
      <UiCardTitle class="text-2xl liquid-glass-text">
        身份验证
      </UiCardTitle>
      <UiCardDescription class="liquid-glass-text-muted">
        请输入您的UID和密码
      </UiCardDescription>
    </UiCardHeader>
    <UiCardContent>
      <form class="grid gap-4" @submit="onSubmit">
        <div class="grid gap-2">
          <UiLabel for="uid" class="liquid-glass-label">
            UID
          </UiLabel>
          <UiInput
            id="uid"
            type="text"
            required
            class="liquid-glass-input text-white placeholder:text-white/40"
            placeholder="请输入UID"
            :model-value="values.uid"
            @update:model-value="v => updateField('uid', v)"
          />
        </div>
        <div class="grid gap-2">
          <UiLabel for="password" class="liquid-glass-label">
            密码
          </UiLabel>
          <UiInput
            id="password"
            type="password"
            required
            placeholder="请输入密码"
            class="liquid-glass-input text-white placeholder:text-white/40"
            :model-value="values.password"
            @update:model-value="v => updateField('password', v)"
          />
        </div>
        <div class="grid gap-2">
          <UiLabel for="captchaCode" class="liquid-glass-label">
            验证码
          </UiLabel>
          <div class="flex items-center gap-2">
            <UiInput
              id="captchaCode"
              type="text"
              required
              class="flex-1 liquid-glass-input text-white placeholder:text-white/40"
              placeholder="请输入验证码"
              :model-value="values.captchaCode"
              @update:model-value="v => updateField('captchaCode', v)"
            />
            <div
              class="h-9 min-w-28 cursor-pointer liquid-glass-input flex items-center justify-center overflow-hidden relative"
              :class="{ 'animate-pulse': captchaLoading }"
              @click="handleCaptchaClick"
            >
              <template v-if="captchaLoading">
                <UiSpinner class="size-4" />
              </template>
              <template v-else-if="captchaData?.svg">
                <div v-html="captchaData.svg" />
              </template>
              <template v-else>
                <span class="text-xs liquid-glass-text-muted">
                  点击获取验证码
                </span>
              </template>
            </div>
          </div>
          <p class="text-xs liquid-glass-text-muted">
            验证码为4位英文+数字，不区分大小写
          </p>
        </div>

        <UiButton class="w-full liquid-glass-button text-white" type="submit" :disabled="loading">
          <UiSpinner v-if="loading" class="mr-2" />
          身份验证
        </UiButton>
      </form>
    </UiCardContent>
  </UiCard>

  <!-- 滑动验证弹窗 -->
  <SlideVerifyDialog
    v-model:open="showSlideVerify"
    @success="handleSlideSuccess"
  />
</template>
