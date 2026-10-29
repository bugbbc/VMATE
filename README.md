# VMATE website + community

原有产品网站新增 `/community.html` 用户社区。英文界面保持现有品牌风格，支持手机和桌面端。

## 已实现

- 首页、产品详情页的社区入口；从产品详情进入时自动筛选对应香型。
- 注册、登录、退出；游客可浏览，登录后可发帖和回复。
- 标题、正文、emoji 选择器、香型、主题、可选 1–5 星体验评分。
- 每帖最多 4 张图片，选择/拖放上传、预览、移除、点击放大。
- 图片在浏览器端缩到最长 1600px 并重新编码 JPEG；源文件最多 8 MB，上传文件最多 2 MB。支持 JPEG、PNG、WebP，不支持 HEIC 或动态图。
- 帖子搜索、主题和香型筛选、最新/点赞排序、分页。
- 点赞、评论、分享链接、删除本人内容、举报和管理员审核。
- 服务端持久化：Cloudflare D1 保存账户、帖子和评论，Cloudinary 保存图片（兼容旧 R2 图片）；不使用 localStorage 模拟社区。
- 参数绑定、文本安全渲染、同源写入检查、HttpOnly 会话、密码 PBKDF2 哈希、服务端图片校验及操作限流。

## 本地运行（不需要 Cloudflare 登录）

使用 Node.js 22 或更新版本。安装项目依赖，然后启动：

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:8787/community.html`。首次启动会自动应用 D1 迁移。`wrangler.local.jsonc` 使用本机模拟 D1/R2，不需要开通 R2 或注册 Cloudinary。Wrangler 在 `.wrangler/state` 保存本地数据，重启后继续保留。数据库 ID 的全零占位值仅用于本地开发。

```sh
npm test        # 本地 D1/R2 与 Cloudinary 模拟 HTTP 集成测试
npm run test:dom # 另一个终端，需先启动 npm run dev；验证页面事件和接口联动
npm run test:e2e # 另一个终端，需先启动 npm run dev；使用系统 Google Chrome
```

浏览器测试会注册 `qa_` 开头的测试账号，创建后删除测试帖子；账号只存在本地数据库。请在独立测试数据库上执行浏览器测试。测试截图默认写入仓库上一级的 `outputs/`，可用 `ARTIFACT_DIR` 指定位置。测试脚本拒绝线上地址。

## 接入现有 Cloudflare 网站

此项目同时提供 Workers Static Assets 和 Pages Functions 两条部署路径。**现有站点如果是 Cloudflare Pages，优先按下面的 Pages 步骤接入原项目，不需要换域名或创建第二个网站。**

图片存储默认使用 **Cloudinary Free**，无需开通 R2。完整的控制台操作见 [Cloudinary 配置指南](docs/CLOUDINARY_SETUP.md)。在 Cloudflare 运行时变量中填写：

| 变量名 | 类型 | 值 |
| --- | --- | --- |
| `CLOUDINARY_CLOUD_NAME` | 普通文本 | Cloudinary Cloud name |
| `CLOUDINARY_API_KEY` | Secret / Encrypt | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Secret / Encrypt | Cloudinary API secret |

不需要 unsigned upload preset。密钥只保存在服务端；上传经过登录、限流和图片检查后，由服务端签名发送。未配置图片存储时，文字发帖和评论仍可用。

已有 D1 数据库直接复用，无需重建或修改表结构。还没有数据库时，可在控制台创建并执行 `migrations/0001_community.sql`，或用 CLI：

```sh
npx wrangler login
npx wrangler d1 create vmate-community
```

CLI 部署前把返回的 D1 database_id 填入对应配置；Pages Git 集成使用下面的控制台绑定即可。不要把 API token、密码或 `.dev.vars` 提交进 Git。

### A. 现有 Cloudflare Pages

1. 将 `wrangler.pages.jsonc` 中的 `name` 改为**现有 Pages 项目名**，填入真实 D1 ID。
2. 对该数据库应用迁移：

   ```sh
   npx wrangler d1 migrations apply DB --remote --config wrangler.pages.jsonc
   ```

3. 本地构建并上传到原 Pages 项目：

   ```sh
   npm run build
   npx wrangler pages deploy dist --config wrangler.pages.jsonc
   ```

   或运行 `npm run deploy:pages`，该脚本执行迁移、构建和上传。

4. 如果使用 Pages 的 Git 集成，构建命令设为 `npm run build`，输出目录设为 `dist`，项目根目录保持仓库根。仓库使用显式命名的 `wrangler.worker.jsonc` 和 `wrangler.pages.jsonc`，不会自动覆盖现有项目配置。现有 Pages Git 集成可继续使用控制台配置；若希望转为配置文件管理，先填好真实资源，再把 `wrangler.pages.jsonc` 作为 `wrangler.jsonc` 使用。对应数据库迁移必须在发布前执行。
5. 在 Pages 项目的 Settings → Bindings 确认 D1 绑定名为 `DB`，并在 Variables and Secrets 填入上面的 Cloudinary 三项值后重新部署。生产和预览环境使用各自的数据库及图片存储，避免预览写入正式数据。
6. 根目录 `functions/api/[[path]].js` 和 `functions/media/[[path]].js` 会由 Pages 打包为服务端函数；不要只把 `dist` 通过不支持 Functions 的静态拖放方式上传。

### B. Cloudflare Workers Static Assets

1. 在 `wrangler.worker.jsonc` 填入真实 D1 ID，并确认 Worker 名称。
2. 配置 Cloudinary：Cloud name 写入配置的 `vars`，API key 和 API secret 使用 `npx wrangler secret put CLOUDINARY_API_KEY --config wrangler.worker.jsonc` 和 `npx wrangler secret put CLOUDINARY_API_SECRET --config wrangler.worker.jsonc` 交互输入。然后运行 `npm run deploy`，执行构建、数据库迁移和部署。
3. 在 Cloudflare 为这个 Worker 配置域名/路由；已有网站的域名调整应在预览验证后操作。

`dist` 使用显式文件清单构建，不会将源码、数据库、Git 目录或凭据发布出去。`/api/*`、`/media/*` 由 Worker 处理，其余路径继续提供静态网站。

## 管理员

先通过社区页面注册你的账户，再在 D1 控制台执行下列语句，将 `your_username` 替换为真实用户名：

```sql
UPDATE users SET role = 'admin' WHERE username = 'your_username';
```

刷新页面后侧栏出现 **Review reports**。管理员可以查看举报、打开原帖、删除违规帖子或评论、关闭举报。普通用户无法调用管理员接口。

删除帖子时，D1 会同时删除评论、点赞和举报，并把图片加入持久删除队列。Cloudinary 资源删除会请求 CDN 缓存失效。请求后台任务会处理队列；Worker 另有每日定时重试。Pages 不支持该 Worker 定时配置，后续登录/注册也会重试清理；长期无人登录的 Pages 项目可另配计划任务执行清理。

已有 R2 数据时保留 `PHOTOS` 绑定，旧图片继续读取和删除。新上传在配置完整时优先使用 Cloudinary；本次不会迁移旧图片。默认生产配置不再创建或绑定 R2。

## 当前范围与运营说明

- 没有对接 Amazon 订单，因此注册用户均可发言；不展示“已购认证”，也不伪造用户、评价或人数。若需要仅买家发言，后续接入可验证的订单数据或独立兑换码流程。
- 当前账户使用用户名和密码，不收集邮箱，因此暂不支持邮件找回密码或邮件验证。请妥善保存登录信息。
- 举报由管理员人工查看，尚未接入自动内容审核、垃圾注册挑战或邮件通知。
- 文本和图片是公开发布内容；界面提醒用户不要发布地址、订单号和未经授权的人像。运营方需结合实际业务完善隐私政策、社区规则和数据保留要求。
- 生产上线前使用独立预览环境验证域名、数据库和存储绑定；本地运行成功并不代表线上绑定已创建。

Cloudflare 官方参考：[Static Assets](https://developers.cloudflare.com/workers/static-assets/)、[D1](https://developers.cloudflare.com/d1/worker-api/)、[Cloudinary](https://cloudinary.com/documentation/image_upload_api_reference)、[Pages Functions](https://developers.cloudflare.com/pages/functions/)。
