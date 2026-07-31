<script lang="ts" setup>
const signUpUrl = `${import.meta.env.BASE_URL}auth/sign-up`
</script>

<template>
  <UiButton as="a" :href="signUpUrl" variant="outline">
    注册
  </UiButton>
</template>
