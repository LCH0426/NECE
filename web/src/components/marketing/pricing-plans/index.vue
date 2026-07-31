<script lang="ts" setup>
import { Icon } from '@iconify/vue'

interface Plan {
  id: string | number
  title: string
  description: string
  badge?: string
  price: string
  unit: string
  discount: string
  recommendation?: boolean
  billing?: {
    cycle: string
    period: string
  }
  features: string[]
}

const plans: Plan[] = [
  {
    id: 1,
    title: '业余爱好者',
    description: '三年提高技能',
    price: '399',
    discount: '599',
    unit: '¥',
    billing: {
      cycle: '',
      period: '',
    },
    features: [
      '使用网站部分代码',
      '获取最新的技术更新',
      '超过 100 个组件',
      '超过 100 个页面',
    ],
  },
  {
    id: 2,
    recommendation: true,
    title: '入门计划',
    description: '五年提高技能',
    price: '599',
    discount: '899',
    unit: '¥',
    billing: {
      cycle: '',
      period: '',
    },
    features: [
      '使用网站全部代码',
      '阅读精彩的在线文档',
      '获取最新的技术更新',
      '超过 200 个组件',
      '超过 200 个页面',
    ],
  },
  {
    id: 3,
    title: '商务计划',
    description: '十年提高技能',
    price: '199',
    discount: '399',
    unit: '$',
    billing: {
      cycle: '',
      period: '',
    },
    features: [
      '使用网站全部代码',
      '阅读精彩的在线文档',
      '获取最新的技术更新',
      '超过 200 个组件',
      '超过 200 个页面',
      '私人助理支持',
    ],
  },
]
</script>

<template>
  <div id="pricing-plans">
    <h2 class="text-center font-black my-4 text-4xl">
      定价计划
    </h2>
    <h4 class="text-center text-xl">
      选择最适合你的计划
    </h4>
    <div
      class="flex flex-col lg:flex-row lg:items-start items-center justify-center gap-4 mt-8"
    >
      <UiCard
        v-for="plan in plans"
        :key="plan.id"
        class="w-full lg:w-1/5"
        :class="{
          'border-2 border-primary bg-primary/10':
            plan.recommendation,
        }"
      >
        <h3 class="text-xl font-black text-center">
          {{ plan.title }}
        </h3>
        <div class="text-sm text-center text-neutral-400">
          {{ plan.description }}
        </div>

        <div class="flex items-top my-2 justify-center">
          <div class="text-2xl font-black">
            {{ plan.unit }}
            <span class="text-4xl">{{ plan.price }}</span>
          </div>
          <div
            v-if="plan.discount"
            class="text-sm font-bold line-through text-neutral-400"
          >
            {{ plan.unit }}{{ plan.discount }}
          </div>
        </div>

        <div class="text-sm mb-4 text-center">
          <ul>
            <li v-for="feature in plan.features" :key="feature" class="mb-1">
              <Icon icon="carbon:checkmark" class="inline-block" />
              {{ feature }}
            </li>
          </ul>
        </div>
        <div class="flex justify-center mx-8">
          <UiButton block>
            立即购买
          </UiButton>
        </div>
      </UiCard>
    </div>
  </div>
</template>
