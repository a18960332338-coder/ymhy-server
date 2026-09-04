import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, Toast } from '@douyinfe/semi-ui'
import zh_CN from '@douyinfe/semi-ui/lib/es/locale/source/zh_CN'
import '@douyinfe/semi-theme-default/scss/index.scss'
import App from './App.jsx'
// HeroUI v3 + Tailwind v4（已去掉 preflight）；放在 App.css 之前，
// 这样冲突时仍以项目原有自定义样式为准，未迁移页面视觉不受影响
import './styles/heroui.css'
import './App.css'

if (typeof window !== 'undefined') {
  window.__SemiToast = Toast
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider locale={zh_CN} theme={{ mode: 'dark', primaryColor: '#5a7a4a' }}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)
