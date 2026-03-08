# Newtab Random Pixiv Images 技术设计

仅覆盖 `src` 目录，暂不考虑 `src_firefox`。

## 1. 目标

本轮设计覆盖以下需求：

1. 补完当前页面图片的收藏功能
2. 优化随机选择的随机性
3. 支持用户层级的喜欢 / 不喜欢
4. 支持随机 tag 池，避免每次请求都拼接大量 tag
5. 首次打开时支持默认图兜底
6. 默认图需要支持配置
7. 支持一键开关随机图片功能，关闭后固定显示默认图

## 2. 非目标

1. 不处理 `src_firefox`
2. 不引入构建系统或框架改造
3. 不调整现有主视觉风格
4. 不在本轮实现复杂推荐算法，只做可控、易维护的加权和过滤

## 3. 当前实现概况

### 3.1 页面层

`src/index.js`

1. 新标签页初始化后直接发送 `fetchImage`
2. 接收到作品数据后更新背景、标题、作者、标签弹窗
3. `likeButton` 当前仅打开作品页，没有真正执行收藏
4. `dislikeButton` 当前只支持按 tag 排除

`src/tags.js`

1. 负责维护 `queryTree`、`queryPresets`、`globalMinusKeywords`
2. 支持导入导出和 preset 管理
3. 保存后通知后台 `updateConfig`

### 3.2 后台层

`src/background.js`

1. 读取本地配置并构建 `SearchSource`
2. 按 Pixiv 查询词请求搜索结果
3. 随机取页、随机取图、简单去重
4. 拉取详情页信息并返回给前台
5. 已实现 `bookmarkIllust`，但前台没有接线

### 3.3 配置层

`src/config.js`

1. 默认配置以 `defaultConfig` 为入口
2. 查询逻辑以 `queryTree` 为主
3. 仍兼容旧字段 `andKeywords/orGroups/minusKeywords`
4. 已有 `migrateConfig` 负责旧配置升级

## 4. 设计原则

1. 新功能优先复用现有 `storage.local + runtime message` 模型
2. 配置模型统一收口到 `config.js`
3. UI 改动尽量集中在 `tags.html/tags.js` 和 `index.html/index.js`
4. 后台保持“可恢复、可兜底”的请求策略，网络失败时优先回退到默认图
5. 所有新增配置都必须可迁移、可导入导出

## 5. 配置模型设计

在 `src/config.js` 的 `defaultConfig` 中新增以下字段：

```js
randomImageEnabled: true,
defaultImageUrl: "",
defaultImageFit: "cover",
defaultImageSourceType: "url",
likedUserIds: [],
dislikedUserIds: [],
randomTagPoolEnabled: false,
randomTagPool: [],
randomTagPoolPickCount: 0,
randomSeedStrategy: "page_pool",
seenHistoryLimit: 300,
seenHistoryTtlMs: 21600000
```

字段说明：

1. `randomImageEnabled`
   控制是否启用随机 Pixiv 图片。关闭时直接显示默认图，不请求 Pixiv。

2. `defaultImageUrl`
   默认图地址。第一阶段先支持 URL 字符串；如果后续需要支持本地上传，可以扩展为 data URL 或 blob URL 持久化。

3. `defaultImageFit`
   默认图显示策略，先保留 `cover`，后续可扩展为 `contain`。

4. `defaultImageSourceType`
   当前预留字段，先支持 `url`，后续可以支持 `upload`。

5. `likedUserIds`
   用户级喜欢名单。第一阶段只作为“优先保留和优先命中”的候选加权来源。

6. `dislikedUserIds`
   用户级不喜欢名单。作为硬过滤条件。

7. `randomTagPoolEnabled`
   控制是否启用随机 tag 池。

8. `randomTagPool`
   存储随机 tag 池条目。建议采用对象数组结构，而不是纯字符串数组，便于后续扩展。

```js
[
  { id: "uuid-or-stable-key", type: "tag", value: "初音ミク" },
  { id: "uuid-or-stable-key", type: "group", connector: "OR", values: ["夕焼け", "朝焼け"] }
]
```

9. `randomTagPoolPickCount`
   每次请求从 tag 池抽取的条目数。

10. `randomSeedStrategy`
    预留给随机策略切换，当前可以只支持 `page_pool`。

11. `seenHistoryLimit`
    最近已看作品上限。

12. `seenHistoryTtlMs`
    最近已看作品的有效期，避免长时间运行后永久污染随机性。

### 5.1 迁移策略

在 `migrateConfig(config)` 中增加以下逻辑：

1. 为所有新增字段填默认值
2. 确保 `likedUserIds/dislikedUserIds/randomTagPool` 始终为数组
3. 确保 `randomTagPoolPickCount` 为非负整数
4. 对空字符串默认图进行容错
5. 旧版本导入文件缺少这些字段时自动补齐

### 5.2 导入导出策略

修改 `src/tags.js`：

1. `saveTags()` 写入新增字段
2. `importFromJsonFile()` 读取新增字段并做兜底
3. `exportToJsonFile()` 导出新增字段

## 6. 默认图与随机开关设计

### 6.1 用户体验目标

1. 新标签页首次打开时，立即可见默认图
2. 如果随机图请求成功，用随机图覆盖默认图
3. 如果请求失败，保留默认图并提示错误
4. 如果关闭随机图片功能，则始终显示默认图

### 6.2 前台改动

修改 `src/index.js`：

1. 新增启动阶段读取本地配置的逻辑
2. 在发送 `fetchImage` 前先渲染默认图
3. 当 `randomImageEnabled=false` 时，不再自动触发随机拉图
4. 为默认图渲染封装一个单独方法，例如：

```js
function applyDefaultImage(config) {}
```

5. 将页面状态拆为三种：
   `default`
   `loading-random`
   `random-ready`

### 6.3 后台改动

修改 `src/background.js`：

1. 在 `fetchImage` 消息处理中读取当前配置
2. 如果 `randomImageEnabled=false`，直接返回默认图对象
3. 如果随机请求失败且存在默认图，则返回带 `fallback=true` 标记的默认图响应

建议统一返回结构：

```js
{
  mode: "default" | "random",
  title: "...",
  userName: "...",
  imageObjectUrl: "...",
  profileImageUrl: "...",
  illustId: "...",
  illustIdUrl: "...",
  tags: [],
  fallback: false
}
```

### 6.4 默认图数据来源

第一阶段先支持 URL 配置，不支持上传文件。原因：

1. 改动最小
2. 不需要额外二进制持久化处理
3. 足够覆盖“公司统一默认背景”或“个人固定图”的需求

第二阶段如果要支持上传：

1. 在 `tags.html` 增加文件选择控件
2. 用 `FileReader.readAsDataURL()` 持久化
3. 注意 `storage.local` 容量

## 7. 收藏功能设计

### 7.1 当前问题

`src/background.js` 已经实现 `bookmarkIllust`，但 `src/index.js` 的 `handleLike()` 只会打开作品页，功能没有闭环。

### 7.2 前台改动

修改 `src/index.js`：

1. `handleLike()` 改为发送 `bookmarkIllust`
2. 成功后给 `likeButton` 增加 `liked` 样式
3. 失败时显示错误 toast
4. 若返回 `TOKEN_NOT_FOUND` 或登录态失败，可提示“请先登录 Pixiv”
5. 可选兜底策略：
   如果收藏失败，提供“打开作品页”的二次操作，而不是直接替代收藏

建议实现：

```js
function handleLike() {
  if (!currentIllustId) return;
  chrome.runtime.sendMessage({ action: "bookmarkIllust", illustId: currentIllustId }, ...);
}
```

### 7.3 后台改动

`src/background.js` 主要保持现有实现，只做以下增强：

1. 标准化错误码
2. 避免重复收藏时前端重复点按导致并发请求
3. 若 `bookmarkIllust` 成功，返回 `{ success: true, illustId }`

### 7.4 UI 样式

修改 `src/style.css`：

1. 强化 `#likeButton.liked` 状态
2. 增加 `loading` 样式，防止重复点击

## 8. 随机性优化设计

### 8.1 当前问题

当前逻辑是：

1. 随机页
2. 页内随机图
3. 用 `seenIds` 做近期去重

问题：

1. 页级采样可能过于集中
2. 每次都现拉数据，首屏慢
3. 没有页面缓存和候选池
4. `seenIds` 只有数量上限，没有时间维度

### 8.2 新策略

在 `SearchSource` 内部引入以下结构：

```js
this.pageCache = new Map();
this.pageCacheLimit = 8;
this.candidateQueue = [];
this.seenMap = new Map(); // id => timestamp
```

### 8.3 抽样流程

新的 `getRandomIllust()` 建议流程：

1. 计算当前查询词
2. 在缓存中检查是否已有可用候选
3. 如果候选不足，则随机拉取若干页补充缓存
4. 对缓存页内作品进行过滤
5. 过滤掉 `seenMap` 中未过期的作品
6. 将剩余作品压入 `candidateQueue`
7. 从 `candidateQueue` 随机取一个
8. 记录到 `seenMap`
9. 定期清理过期记录和超限缓存

### 8.4 去重策略

`seenMap` 清理规则：

1. 超过 `seenHistoryTtlMs` 的记录删除
2. 超过 `seenHistoryLimit` 时，按最早时间淘汰

### 8.5 预取策略

Chrome 版可增加轻量预取，但不做复杂后台常驻队列。

建议：

1. 首次启动时只拉取 1 张，尽快响应
2. 返回 1 张后，用 `setTimeout` 异步预热下一批候选页
3. 配置变更后清空所有缓存

## 9. 用户级喜欢 / 不喜欢设计

### 9.1 数据结构

新增：

```js
likedUserIds: [],
dislikedUserIds: []
```

### 9.2 语义设计

1. `dislikedUserIds`
   硬过滤。只要作品作者命中，就直接跳过。

2. `likedUserIds`
   软偏好。不是强制只看这些作者，而是在候选选择时增加命中概率。

### 9.3 前台交互

修改 `src/index.html` 和 `src/index.js`：

1. 在当前作者区域增加用户级操作入口
2. 方案 A：在现有 dislike 弹窗中加入“屏蔽作者”
3. 方案 B：在作者头像或名称旁增加一个菜单按钮

建议优先方案 A，改动更小。

弹窗新增操作项：

1. 屏蔽标签
2. 屏蔽作者
3. 喜欢作者

### 9.4 后台过滤 / 加权

在 `getRandomIllust()` 获取到作品详情后：

1. 如果 `userId` 在 `dislikedUserIds` 中，跳过
2. 如果 `userId` 在 `likedUserIds` 中，给该作品打高权重

加权方式建议简单实现：

1. 先分成 `likedCandidates` 和 `normalCandidates`
2. 按固定概率优先从 `likedCandidates` 中抽取，例如 60%
3. 如果 `likedCandidates` 为空，则回退到普通候选

## 10. 随机 tag 池设计

### 10.1 设计目标

1. 避免固定拼出超长 URL
2. 让每次请求都能在大方向一致的前提下有变化
3. 保持与现有 `queryTree` 兼容

### 10.2 查询拆分

将查询条件拆成两部分：

1. 强限制条件
   来自当前 `queryTree` 中必须保留的部分，以及全局屏蔽词

2. 随机 tag 池
   从一个单独池子里每次抽若干项附加到查询上

建议不要直接从 `queryTree` 自动推导随机池，而是显式配置，避免规则隐式化。

### 10.3 配置结构

```js
randomTagPoolEnabled: true,
randomTagPoolPickCount: 2,
randomTagPool: [
  { id: "1", type: "tag", value: "初音ミク" },
  { id: "2", type: "tag", value: "風景" },
  { id: "3", type: "group", connector: "OR", values: ["青空", "雲"] }
]
```

### 10.4 查询生成逻辑

在 `src/config.js` 增加：

```js
export function buildRequestQuery(config) {}
export function buildRandomPoolClause(config) {}
```

规则：

1. 基础查询来自当前 preset 的 `queryTree`
2. 如果 `randomTagPoolEnabled=false`，直接返回基础查询
3. 如果启用，则从 `randomTagPool` 随机抽取 `randomTagPoolPickCount` 条
4. 抽中的条目以 AND 形式拼接到基础查询后
5. 全局屏蔽词始终追加到末尾

### 10.5 UI 设计

修改 `src/tags.html` 和 `src/tags.js`：

1. 增加随机 tag 池开关
2. 增加池条目列表编辑区
3. 增加每次抽取数量输入框
4. 增加请求预览区，展示“基础查询”和“本次样本查询”

## 11. 页面与消息协议调整

### 11.1 新增消息

在 `src/index.js` 与 `src/background.js` 间新增或规范以下消息：

1. `fetchImage`
2. `bookmarkIllust`
3. `excludeTag`
4. `setUserPreference`
5. `getRuntimeConfig`

建议 `setUserPreference` 结构：

```js
{
  action: "setUserPreference",
  userId: "123456",
  preference: "like" | "dislike" | "clear"
}
```

### 11.2 标准响应结构

建议统一返回：

```js
{
  success: true,
  data: {}
}
```

或：

```js
{
  success: false,
  code: "SOME_ERROR",
  message: "..."
}
```

当前代码里 `fetchImage` 和其他 action 的响应风格不一致，后续应统一。

## 12. 文件级改动清单

### 12.1 `src/config.js`

1. 增加默认配置字段
2. 扩展 `migrateConfig`
3. 增加 `buildRequestQuery`
4. 增加随机 tag 池构造函数

### 12.2 `src/background.js`

1. 统一配置读取逻辑
2. 处理随机图开关
3. 支持默认图响应
4. 接入改进后的随机策略
5. 接入用户级喜欢 / 不喜欢
6. 支持新的消息 `setUserPreference`
7. 统一错误码和返回结构

### 12.3 `src/index.js`

1. 启动时先渲染默认图
2. 根据随机开关决定是否请求 Pixiv
3. 收藏按钮改为真正收藏
4. 增加用户级偏好操作入口
5. 优化 toast 和按钮状态

### 12.4 `src/index.html`

1. 为作者级操作增加入口
2. 视情况扩展当前弹窗结构

### 12.5 `src/style.css`

1. 默认图状态样式
2. 收藏按钮 `loading/liked` 样式
3. 用户级操作按钮样式

### 12.6 `src/tags.html`

1. 增加随机图片开关
2. 增加默认图配置区域
3. 增加随机 tag 池配置区域
4. 视情况增加预览区域

### 12.7 `src/tags.js`

1. 读写新增配置字段
2. 绑定随机开关和默认图输入
3. 维护随机 tag 池编辑状态
4. 更新导入导出逻辑

## 13. 分阶段实施方案

### Phase 1

1. 配置模型扩展
2. 默认图配置
3. 随机图片开关
4. 首屏默认图兜底

交付结果：

1. 新标签页打开更快
2. 随机关闭后可稳定显示默认图
3. 配置可保存、导入、导出

### Phase 2

1. 收藏功能补齐
2. Like 按钮状态和错误反馈完善

交付结果：

1. 当前图片可以直接收藏到 Pixiv

### Phase 3

1. 随机性优化
2. 页面缓存
3. 候选池
4. seen 记录 TTL

交付结果：

1. 重复率降低
2. 二次刷新速度提升

### Phase 4

1. 用户级喜欢 / 不喜欢
2. 用户过滤与加权

交付结果：

1. 能直接按作者建立偏好

### Phase 5

1. 随机 tag 池
2. 查询词构造优化

交付结果：

1. 查询灵活性提升
2. 请求 URL 更可控

## 14. 风险与注意事项

1. Pixiv 接口和登录态依赖较强，收藏功能要充分处理未登录和 token 失效场景
2. 默认图如果使用远程 URL，需要考虑跨域和图片失效问题
3. 如果未来支持上传默认图，要注意 `chrome.storage.local` 容量限制
4. 随机 tag 池如果与 `queryTree` 冲突，可能导致查询过窄，需要在 UI 上提示
5. 用户级喜欢如果做成硬过滤，会显著降低随机性，因此建议默认使用加权而不是强过滤

## 15. 验收清单

1. 默认图可配置并持久化
2. 新标签页首屏在慢网下也能立即显示默认图
3. 关闭随机图片后不会发起 Pixiv 随机请求
4. 收藏按钮可以真正收藏当前作品
5. 连续刷新 20 次，重复率明显低于当前实现
6. 可以对当前作者执行喜欢 / 不喜欢
7. 用户级不喜欢作者不会再次出现
8. 启用随机 tag 池后，请求查询词长度可控
9. 导入导出后新增配置不丢失
