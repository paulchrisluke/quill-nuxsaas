# API Call Optimization Guide

## Problem
Currently, each page makes 2-3 API calls:
- Layout: `/api/auth/organization/get-full-organization`
- Billing page: `/api/auth/organization/get-full-organization` + `/api/auth/subscription/list`
- Members page: `/api/auth/subscription/list`

**Result:** Slow page loads, redundant data fetching, wasted bandwidth

## Solution
Single unified endpoint that returns ALL data needed for organization pages.

## New Unified Endpoint

### `/api/organization/page-data`

Returns:
```typescript
{
  organization: {
    id, name, slug, logo, members, invitations, ...
  },
  subscriptions: [
    { id, status, plan, periodEnd, ... }
  ],
  user: {
    id, email, name, role
  }
}
```

## Usage in Pages

### Before (Multiple Calls):
```vue
<script setup>
// Layout fetches org
const { data: layoutOrgData } = await useAsyncData(...)

// Page ALSO fetches org + subscriptions
const { data: pageData } = await useAsyncData(async () => {
  const orgData = await $fetch('/api/auth/organization/get-full-organization')
  const subsData = await $fetch('/api/auth/subscription/list')
  return { organization: orgData, subscriptions: subsData }
})
</script>
```

### After (Single Call):
```vue
<script setup>
// Single call gets everything
const { data: pageData } = await useAsyncData(
  `page-data-${route.params.slug}`,
  () => $fetch('/api/organization/page-data', {
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
  })
)

// Extract what you need
const organization = computed(() => pageData.value?.organization)
const subscriptions = computed(() => pageData.value?.subscriptions || [])
const activeSub = computed(() => 
  subscriptions.value.find(s => s.status === 'active' || s.status === 'trialing')
)
</script>
```

## Updated Files

### 1. Layout (`app/layouts/dashboard.vue`)
```vue
<script setup>
// Use unified endpoint
const { data: layoutData } = await useAsyncData(
  `layout-data-${route.params.slug}`,
  () => $fetch('/api/organization/page-data', {
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
  }),
  {
    immediate: true,
    watch: [() => route.params.slug]
  }
)

// Sync with activeOrg
const activeOrg = useActiveOrganization()
watch(() => layoutData.value?.organization, (newOrg) => {
  if (newOrg && activeOrg.value) {
    activeOrg.value.data = newOrg as any
  }
}, { immediate: true })
</script>
```

### 2. Billing Page (`app/pages/[slug]/billing.vue`)
```vue
<script setup>
// Single call gets org + subscriptions
const { data: pageData } = await useAsyncData(
  `billing-${route.params.slug}`,
  () => $fetch('/api/organization/page-data', {
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
  })
)

// Extract data
const subscriptions = computed(() => pageData.value?.subscriptions || [])
const activeSub = computed(() => 
  subscriptions.value.find(s => s.status === 'active' || s.status === 'trialing')
)

// Refresh function
const refresh = async () => {
  const data = await $fetch('/api/organization/page-data')
  if (pageData.value) {
    pageData.value.subscriptions = data.subscriptions
  }
}
</script>
```

### 3. Members Page (`app/pages/[slug]/members.vue`)
```vue
<script setup>
// Single call gets org + subscriptions
const { data: pageData } = await useAsyncData(
  `members-${route.params.slug}`,
  () => $fetch('/api/organization/page-data', {
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
  })
)

// Extract data
const organization = computed(() => pageData.value?.organization)
const subscriptions = computed(() => pageData.value?.subscriptions || [])
const isPro = computed(() => 
  subscriptions.value.some(s => s.status === 'active' || s.status === 'trialing')
)
</script>
```

## Benefits

### Performance
- ✅ **1 API call** instead of 2-3
- ✅ **Parallel fetching** on server (org + subs fetched simultaneously)
- ✅ **Reduced latency** (no waterfall requests)
- ✅ **Less bandwidth** (single HTTP request overhead)

### Developer Experience
- ✅ **Consistent data** across layout and pages
- ✅ **Single source of truth** for page data
- ✅ **Easier debugging** (one endpoint to monitor)
- ✅ **Type safety** (single response type)

### Caching
```vue
// Nuxt automatically caches the response
// All pages using the same slug share the cache
const { data } = await useAsyncData(
  `page-data-${slug}`, // Same key = shared cache
  () => $fetch('/api/organization/page-data')
)
```

## Migration Checklist

- [x] Create `/server/api/organization/page-data.get.ts`
- [ ] Update `app/layouts/dashboard.vue` to use unified endpoint
- [ ] Update `app/pages/[slug]/billing.vue` to use unified endpoint
- [ ] Update `app/pages/[slug]/members.vue` to use unified endpoint
- [ ] Update `app/pages/[slug]/settings.vue` to use unified endpoint
- [ ] Test all pages load correctly
- [ ] Verify data refreshes work after mutations
- [ ] Check SSR hydration works properly

## Testing

### Before:
```bash
# Check Network tab
- 3 API calls on billing page load
- 2 API calls on members page load
- Total: ~500-800ms
```

### After:
```bash
# Check Network tab
- 1 API call on any page load
- Total: ~200-300ms
```

## Notes

- The endpoint uses `Promise.all()` to fetch org + subscriptions in parallel
- Error handling ensures subscriptions failure doesn't break the page
- Cookie forwarding ensures SSR works correctly
- Cache keys include slug to prevent cross-org data leaks
