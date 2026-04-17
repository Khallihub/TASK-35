import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes = [
  { path: '/login', name: 'Login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
  { path: '/', redirect: '/listings' },
  { path: '/listings', name: 'Listings', component: () => import('@/views/ListingsView.vue') },
  { path: '/listings/new', name: 'ListingCreate', component: () => import('@/views/ListingCreateView.vue') },
  { path: '/listings/:id', name: 'ListingDetail', component: () => import('@/views/ListingDetailView.vue') },
  { path: '/listings/:id/edit', name: 'ListingEdit', component: () => import('@/views/ListingEditView.vue') },
  { path: '/listings/:id/attachments', name: 'Attachments', component: () => import('@/views/AttachmentsView.vue') },
  { path: '/promo', name: 'Promo', component: () => import('@/views/PromoView.vue'), meta: { roles: ['operations', 'administrator'] } },
  { path: '/promo/:id', name: 'PromoDetail', component: () => import('@/views/PromoDetailView.vue'), meta: { roles: ['operations', 'administrator'] } },
  // Analytics is an Operations capability per the product brief — merchants
  // and regular users do not have KPI/export access. Kept in sync with the
  // API-side `canAccessAnalytics` gate in routes/analytics.ts.
  { path: '/analytics', name: 'Analytics', component: () => import('@/views/AnalyticsView.vue'), meta: { roles: ['operations', 'administrator'] } },
  { path: '/admin', name: 'Admin', component: () => import('@/views/AdminView.vue'), meta: { roles: ['administrator'] } },
  { path: '/:pathMatch(.*)*', name: 'NotFound', component: () => import('@/views/NotFoundView.vue') },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.isAuthenticated) return '/login'
  // Force password change: block all navigation except login (already handled above)
  // The mustChangePassword flag is set during login; if sessions were revoked server-side,
  // the user must re-login and will be forced to change password.
  if (auth.isAuthenticated && auth.mustChangePassword && to.name !== 'Login') {
    // Stay on login page to show the password change modal
    return '/login'
  }
  if (to.meta.roles) {
    const allowed = to.meta.roles as string[]
    if (!auth.user || !allowed.includes(auth.user.role)) return '/listings'
  }
  return true
})
