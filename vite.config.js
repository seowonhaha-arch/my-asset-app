import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 아래와 같이 앞뒤로 슬래시(/)를 포함하여 저장소 이름을 넣습니다.
  base: '/my-asset-app/',
})