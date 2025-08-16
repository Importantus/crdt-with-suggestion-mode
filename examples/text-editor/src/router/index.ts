import { useUserStore } from '@/stores/user'
import HomePage from '@/views/HomePage.vue'
import UserselectionPage from '@/views/UserselectionPage.vue'
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomePage,
    },
    {
      path: '/login',
      name: 'Login',
      component: UserselectionPage,
    },
  ],
})

router.beforeEach((to, from) => {
  const userStore = useUserStore()
  // Check if the user is logged in
  if (to.name !== 'Login' && to.name !== 'Register' && !userStore.activeUser) {
    return { name: 'Login', query: { redirect: to.fullPath } }
  }

  if (
    (to.name === 'Login' || to.name === 'Register') &&
    !to.query.redirect &&
    from.query.redirect
  ) {
    return { name: to.name, query: { redirect: from.query.redirect } }
  }
})

export default router
