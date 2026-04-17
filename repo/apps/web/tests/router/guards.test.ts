import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Router guard behavioural coverage.
 *
 * The production router beforeEach has three responsibilities:
 *   1. Redirect unauthenticated users to /login for any non-public route.
 *   2. Force users with mustChangePassword back to /login (so the modal shows).
 *   3. Enforce role meta on protected routes, redirecting otherwise.
 *
 * These tests reconstruct the same routes + guard against an in-memory
 * history so the full decision matrix is verified without mocking.
 */

// Stub out the view components — the guards don't need the real ones.
const Stub = { template: '<div />' }

function buildRouter() {
  const routes = [
    { path: '/login', name: 'Login', component: Stub, meta: { public: true } },
    { path: '/', redirect: '/listings' },
    { path: '/listings', name: 'Listings', component: Stub },
    { path: '/listings/new', name: 'ListingCreate', component: Stub },
    { path: '/promo', name: 'Promo', component: Stub, meta: { roles: ['operations', 'administrator'] } },
    { path: '/analytics', name: 'Analytics', component: Stub, meta: { roles: ['operations', 'administrator'] } },
    { path: '/admin', name: 'Admin', component: Stub, meta: { roles: ['administrator'] } },
    { path: '/:pathMatch(.*)*', name: 'NotFound', component: Stub },
  ]

  const router = createRouter({ history: createMemoryHistory(), routes })

  // Mirror the production guard from apps/web/src/router/index.ts.
  router.beforeEach(async (to) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAuthStore } = await import('@/stores/auth')
    const auth = useAuthStore()
    if (!to.meta.public && !auth.isAuthenticated) return '/login'
    if (auth.isAuthenticated && auth.mustChangePassword && to.name !== 'Login') return '/login'
    if (to.meta.roles) {
      const allowed = to.meta.roles as string[]
      if (!auth.user || !allowed.includes(auth.user.role)) return '/listings'
    }
    return true
  })

  return router
}

beforeEach(() => {
  setActivePinia(createPinia())
  // The auth store persists to localStorage — clear between tests.
  localStorage.clear()
})

// Minimal auth API mock so the store doesn't explode if anything calls it.
vi.mock('@/api/auth', () => ({
  authApi: {
    getLoginNonce: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    acceptConsent: vi.fn(),
    changePassword: vi.fn(),
    getConsentVersion: vi.fn(),
  },
}))

describe('router guard — unauthenticated access', () => {
  it('redirects to /login when navigating to a protected route unauthenticated', async () => {
    const router = buildRouter()
    await router.push('/listings')
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('allows navigation to the public /login page without a session', async () => {
    const router = buildRouter()
    await router.push('/login')
    expect(router.currentRoute.value.path).toBe('/login')
  })
})

describe('router guard — role enforcement', () => {
  async function authAs(role: string) {
    const { useAuthStore } = await import('@/stores/auth')
    const store = useAuthStore()
    // Seed the store with minimal state so isAuthenticated becomes true.
    store.accessToken = 'fake-access-token'
    store.user = { id: 1, username: 'u', role, officeId: 1 }
  }

  it('ops user can reach /analytics and /promo', async () => {
    const router = buildRouter()
    await authAs('operations')

    await router.push('/analytics')
    expect(router.currentRoute.value.path).toBe('/analytics')

    await router.push('/promo')
    expect(router.currentRoute.value.path).toBe('/promo')
  })

  it('merchant is bounced from /analytics back to /listings', async () => {
    const router = buildRouter()
    await authAs('merchant')
    await router.push('/analytics')
    expect(router.currentRoute.value.path).toBe('/listings')
  })

  it('regular_user is bounced from /promo back to /listings', async () => {
    const router = buildRouter()
    await authAs('regular_user')
    await router.push('/promo')
    expect(router.currentRoute.value.path).toBe('/listings')
  })

  it('non-admin is bounced from /admin back to /listings', async () => {
    const router = buildRouter()
    await authAs('operations')
    await router.push('/admin')
    expect(router.currentRoute.value.path).toBe('/listings')
  })

  it('admin can reach /admin', async () => {
    const router = buildRouter()
    await authAs('administrator')
    await router.push('/admin')
    expect(router.currentRoute.value.path).toBe('/admin')
  })
})

describe('router guard — mustChangePassword forces /login', () => {
  it('even an authenticated user with mustChangePassword is redirected to /login', async () => {
    const { useAuthStore } = await import('@/stores/auth')
    const router = buildRouter()
    const auth = useAuthStore()
    auth.accessToken = 'fake'
    auth.user = { id: 1, username: 'admin', role: 'administrator', officeId: 1 }
    auth.mustChangePassword = true

    await router.push('/listings')
    expect(router.currentRoute.value.path).toBe('/login')

    await router.push('/analytics')
    expect(router.currentRoute.value.path).toBe('/login')
  })
})
