// 账号模型：云眠A('a') / 云眠B('b')。账号只负责「能看哪些店铺」，数据按店铺存储、全账号互通。
// 内部 ID 与登录 auth.type 对应：云眠A -> 'a'，云眠B -> 'b'。
export const ACCOUNT_LABELS = { a: '云眠A', b: '云眠B' }

// 账号 -> 可见店铺 key 白名单；云眠A 全店，云眠B 除软居与猫外。
export const ACCOUNT_BRAND_PERMS = {
  a: ['cloudsleepgarden', 'sofawithcat', 'lyrosdream', 'oblachny_sad', 'wuduomian'],
  b: ['cloudsleepgarden', 'lyrosdream', 'oblachny_sad', 'wuduomian'],
}

export function accId(account) {
  return account === 'a' ? 'a' : 'b'
}

export function brandPerms(account) {
  return ACCOUNT_BRAND_PERMS[accId(account)] || ACCOUNT_BRAND_PERMS.b
}

// 云眠AI聊天记录：完全全局共用一份（不分店铺、不分账号）
export function aiSessionsKey() { return 'ymhy_ai_chat_sessions_v1_global' }
export function aiPresetKey() { return 'ymhy_ai_chat_preset_v1_global' }

// 偏好设置：所有账号互通，全局一份
export function activeTabKey() { return 'ydp.activeTab.global' }
export function vbsModelKey() { return 'vbs.nano_model_id.global' }
export function vbsShotCardsKey() { return 'vbs.shot_cards.global' }
export function lastModelKey() { return 'tk:last-model.global' }

const MIGRATED_FLAG = 'ydp.records.migrated.v2'

// 一次性迁移：把旧的（按账号/品牌隔离）记录归并到全局 key。
// 由于两个账号数据互通，旧的两个账号作用域记录取任一即可，原 key 保留不删。
export function migrateLegacyRecords() {
  try {
    if (localStorage.getItem(MIGRATED_FLAG)) return
    const copy = (oldKey, newKey) => {
      if (localStorage.getItem(oldKey) != null && localStorage.getItem(newKey) == null) {
        try { localStorage.setItem(newKey, localStorage.getItem(oldKey)) } catch {}
      }
    }
    // 偏好/模型记录（旧 key 无后缀 或 带账号后缀）
    const prefMap = {
      'ydp.activeTab': 'ydp.activeTab.global',
      'vbs.nano_model_id': 'vbs.nano_model_id.global',
      'tk:last-model': 'tk:last-model.global',
      'vbs.shot_cards': 'vbs.shot_cards.global',
    }
    for (const old of Object.keys(prefMap)) copy(old, prefMap[old])
    // 云眠AI会话/预设：旧 key 无后缀（云眠花园品牌）→ 全局
    copy('ymhy_ai_chat_sessions_v1', 'ymhy_ai_chat_sessions_v1_global')
    copy('ymhy_ai_chat_preset_v1', 'ymhy_ai_chat_preset_v1_global')
    // 带品牌后缀的旧 key → 全局（取第一个存在的）
    copy('ymhy_ai_chat_sessions_v1_sofawithcat', 'ymhy_ai_chat_sessions_v1_global')
    copy('ymhy_ai_chat_preset_v1_sofawithcat', 'ymhy_ai_chat_preset_v1_global')
    copy('ymhy_ai_chat_sessions_v1_lyrosdream', 'ymhy_ai_chat_sessions_v1_global')
    copy('ymhy_ai_chat_preset_v1_lyrosdream', 'ymhy_ai_chat_preset_v1_global')
    try { localStorage.setItem(MIGRATED_FLAG, '1') } catch {}
  } catch {}
}

// 模块导入即执行一次迁移，确保在任何组件读取前完成
migrateLegacyRecords()
