import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface User {
  id: string
  name: string
  color: string
}

export const users: User[] = [
  { id: 'user1', name: 'Alice', color: '#3BA5A5' },
  { id: 'user2', name: 'Bob', color: '#D17A22' },
]

export function getUserColor(userId: string, transparency: number = 1): string {
  const user = users.find((u) => u.id === userId)
  if (user) {
    return `${user.color}${Math.round(transparency * 255)
      .toString(16)
      .padStart(2, '0')}`
  }
  console.warn(`User with id ${userId} not found, returning default color`)
  return `#000000${Math.round(transparency * 255)
    .toString(16)
    .padStart(2, '0')}` // Default color with transparency
}

export const useUserStore = defineStore('user', () => {
  const activeUser = ref<User | null>(null)

  function setActiveUser(userId: string) {
    const user = users.find((u) => u.id === userId)
    if (user) {
      activeUser.value = user
    } else {
      console.warn(`User with id ${userId} not found`)
    }
  }

  function logout() {
    activeUser.value = null
    window.location.reload()
  }

  return {
    activeUser,
    setActiveUser,
    logout,
  }
})
