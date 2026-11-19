import React from 'react'
import { Button as HeroButton } from '@heroui/react'
import Icon from '../components/Icon'

// 茄境 · 图片转Live（第二阶段功能，当前占位）
export default function CigarImageToLive() {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
      <div style={{ maxWidth: 880 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 12,
            background: 'var(--accent-soft)', border: '1px solid var(--accent)',
            display: 'grid', placeItems: 'center', fontSize: 22,
          }}><Icon name="video" size={24} /></div>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 700 }}>图片转Live</h1>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 3 }}>
              让静态产品图动起来，生成带运镜的短视频（第二阶段功能）
            </p>
          </div>
          <span style={{
            marginLeft: 'auto', fontSize: 12, color: 'var(--accent)',
            border: '1px solid var(--accent)', borderRadius: 20, padding: '5px 12px', whiteSpace: 'nowrap',
          }}>即将上线</span>
        </div>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14, padding: 40, textAlign: 'center',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', margin: '0 auto 18px',
            background: 'var(--accent-soft)', display: 'grid', placeItems: 'center',
          }}><Icon name="video" size={34} /></div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>图片转 Live 正在开发中</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
            这个功能会把「产品图片生产」生成的静态产品图转换成带轻微运镜、光影流动的短视频，
            用于商品主图动效与短视频素材。当前先聚焦产品图片生产，本功能将在下一阶段开放。
          </p>
          <HeroButton variant="secondary" size="sm" style={{ marginTop: 22 }} isDisabled>
            敬请期待
          </HeroButton>
        </div>
      </div>
    </div>
  )
}
