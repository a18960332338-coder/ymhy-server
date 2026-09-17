import api from './api'

// ============================================================================
// 图库分类 · 唯一权威定义
// ----------------------------------------------------------------------------
// ★★ 铁律：任何「从图库选择…」弹窗的 Tab，都必须来自本文件 ★★
//
// 历史坑：每个弹窗各自硬编码了一份分类列表（TemplateStudio 三处 /
// VideoBatchStudio / AiChat / SuiteGenerator）。图库页后来新增「分镜图 /
// 套图 / 其他生成图」后，这些弹窗依然停在旧的四项（模版图 / 合成图 /
// 主图素材 / 猫咪素材），而且「合成图」把 gen_ / frame_ / suite_ / img_
// 混在同一个 Tab 里 —— 用户看到的就是「弹窗 Tab 和图库 Tab 对不上」。
//
// 现在所有弹窗统一从这里取分类：以后改图库分类，只改 GALLERY_CATEGORIES
// 一处，全部弹窗自动跟随。
//
// 分类口径必须与「图库」页（pages/DesignStudio.jsx → ResultsLibrary）一致：
//   - synthesized 桶按文件名前缀拆分：
//       gen_(合成图) / frame_(分镜图) / suite_(套图) / img_(其他生成图)
//   - 「全部」= synthesized 桶下除 tpl_ 外的全部图片
//   - 模版图 = template_results 桶；主图素材 = mains；猫咪素材 = cats
//   - 排序统一 mtime 降序
// ============================================================================

export const GALLERY_BUCKET = {
  SYNTH: 'synthesized',
  TPL: 'template_results',
  MAINS: 'mains',
  CATS: 'cats',
}

// 袜子品牌（wuduomian）没有猫咪素材分类
const SOCKS_BRAND = 'wuduomian'

export const GALLERY_CATEGORIES = [
  { key: 'all',   label: '全部',       bucket: GALLERY_BUCKET.SYNTH, match: null },
  { key: 'synth', label: '合成图',     bucket: GALLERY_BUCKET.SYNTH, match: /^gen_/i },
  { key: 'frame', label: '分镜图',     bucket: GALLERY_BUCKET.SYNTH, match: /^frame_/i },
  { key: 'tpl',   label: '模版图',     bucket: GALLERY_BUCKET.TPL,   match: null },
  { key: 'suite', label: '套图',       bucket: GALLERY_BUCKET.SYNTH, match: /^suite_/i },
  { key: 'other', label: '其他生成图', bucket: GALLERY_BUCKET.SYNTH, match: /^img_/i },
  { key: 'mains', label: '主图素材',   bucket: GALLERY_BUCKET.MAINS, match: null },
  { key: 'cats',  label: '猫咪素材',   bucket: GALLERY_BUCKET.CATS,  match: null, hideBrands: [SOCKS_BRAND] },
]

// 弹窗打开时优先选中的分类（合成图）
export const DEFAULT_GALLERY_CATEGORY = 'synth'

const byMtimeDesc = (a, b) => (b.mtime || 0) - (a.mtime || 0)

/** 当前品牌可见的分类（袜子品牌隐藏猫咪素材） */
export function visibleGalleryCategories(brand) {
  return GALLERY_CATEGORIES.filter(c => !(c.hideBrands || []).includes(brand))
}

/**
 * 拉取图库并按分类分组：并发请求 4 个桶，一次性返回全部分类。
 * 返回的 images 是「裸」数据（只含 name / mtime），由调用方决定 URL 形态，
 * 因为不同弹窗需要的地址不一样（缩略图 / 原图 / 后端相对路径）。
 *
 * @returns {Promise<Array<{key:string,label:string,bucket:string,images:Array<{name:string,mtime:number}>}>>}
 */
export async function loadGalleryCategories(brand) {
  const [synthRes, tplRes, mainsRes, catsRes] = await Promise.all([
    api.images(GALLERY_BUCKET.SYNTH, { brand }).catch(() => null),
    api.images(GALLERY_BUCKET.TPL, { brand }).catch(() => null),
    api.images(GALLERY_BUCKET.MAINS, { brand }).catch(() => null),
    api.images(GALLERY_BUCKET.CATS, { brand }).catch(() => null),
  ])
  const byBucket = {
    [GALLERY_BUCKET.SYNTH]: (synthRes?.images || []).filter(im => !/^tpl_/i.test(im.name || '')),
    [GALLERY_BUCKET.TPL]: tplRes?.images || [],
    [GALLERY_BUCKET.MAINS]: mainsRes?.images || [],
    [GALLERY_BUCKET.CATS]: catsRes?.images || [],
  }
  return visibleGalleryCategories(brand).map(c => {
    const src = byBucket[c.bucket] || []
    const picked = (c.match ? src.filter(im => c.match.test(im.name || '')) : src)
      .slice().sort(byMtimeDesc)
    return {
      key: c.key,
      label: c.label,
      bucket: c.bucket,
      images: picked.map(im => ({ name: im.name, mtime: im.mtime })),
    }
  })
}

/**
 * 把裸分类映射成弹窗自己的结构。
 * @param categories loadGalleryCategories 的返回值
 * @param mapper (bucket, image) => 自定义图片对象
 */
export function mapCategoryImages(categories, mapper) {
  return categories.map(c => ({
    key: c.key,
    label: c.label,
    bucket: c.bucket,
    images: c.images.map(im => mapper(c.bucket, im)),
  }))
}

/** 默认选中分类：合成图优先；为空则回退到第一个有图的分类 */
export function defaultCategoryKey(categories) {
  const synth = categories.find(c => c.key === DEFAULT_GALLERY_CATEGORY)
  if (synth && synth.images.length > 0) return DEFAULT_GALLERY_CATEGORY
  const first = categories.find(c => c.key !== 'all' && c.images.length > 0)
  return first ? first.key : DEFAULT_GALLERY_CATEGORY
}
