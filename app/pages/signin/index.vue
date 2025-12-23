<script setup lang="ts">
const loading = ref(false)

async function onGoogleLogin() {
  loading.value = true
  try {
    const auth = useAuth()
    await auth.signIn.social({ provider: 'google', callbackURL: '/' })
  } catch (error) {
    console.error('Sign in error:', error)
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <UCard class="w-full max-w-md">
      <template #header>
        <div class="text-center p-4">
          <h1 class="text-xl font-semibold">
            Sign In
          </h1>
        </div>
      </template>
      <div class="p-4">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-simple-icons-google"
          class="w-full justify-center"
          :loading="loading"
          :disabled="loading"
          @click="onGoogleLogin"
        >
          Sign in with Google
        </UButton>
      </div>
    </UCard>
  </div>
</template>
